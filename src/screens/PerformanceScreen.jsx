import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabaseClient';
import { pnlBase, fmtPnl, fmtShort } from '../lib/formatters';
import { useBaseCurrency } from '../lib/BaseCurrencyContext';
import { computeAdherenceBreakdown } from '../lib/adherenceScore';
import PrivacyValue from '../components/PrivacyValue';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';

// ─── helpers ──────────────────────────────────────────────────────────────────

const PRESETS = ['1D', '1W', '1M', '3M', 'All'];
const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Returns a YYYY-MM-DD string so we can compare against closed_at.slice(0,10)
const presetStartDate = (p) => {
  const now = new Date();
  if (p === '1D') return now.toISOString().slice(0, 10); // today
  if (p === '1W') { const d = new Date(now); d.setDate(d.getDate() - 7); return d.toISOString().slice(0, 10); }
  if (p === '1M') { const d = new Date(now); d.setMonth(d.getMonth() - 1); return d.toISOString().slice(0, 10); }
  if (p === '3M') { const d = new Date(now); d.setMonth(d.getMonth() - 3); return d.toISOString().slice(0, 10); }
  return null;
};

const fmtDay = (iso) => {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

// Returns ISO week string like '2026-W15' for the current date
const currentISOWeek = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const yearStart = new Date(d.getFullYear(), 0, 1);
  const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getFullYear()}-W${weekNo.toString().padStart(2, '0')}`;
};

const sortIcon = (active, dir) => (
  <span className={`ml-1 inline-block ${active ? 'text-blue-600' : 'text-gray-300'}`}>
    {active && dir === 'asc' ? '↑' : '↓'}
  </span>
);

// ─── custom tooltip ────────────────────────────────────────────────────────────

function CurveTip({ active, payload, baseCurrency = 'USD' }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-lg px-4 py-3 text-xs pointer-events-none">
      <p className="font-semibold text-gray-700 mb-1.5">{fmtDay(d.date)}</p>
      <p className={`mb-0.5 ${(d.dayPnl || 0) >= 0 ? 'text-green-600' : 'text-red-500'}`}>
        Day P&L: <PrivacyValue value={fmtPnl(d.dayPnl, baseCurrency)} />
      </p>
      <p className={`font-semibold ${(d.cumPnl || 0) >= 0 ? 'text-blue-600' : 'text-red-500'}`}>
        Cumulative: <PrivacyValue value={fmtPnl(d.cumPnl, baseCurrency)} />
      </p>
    </div>
  );
}

// ─── bar row (direction / asset class) ────────────────────────────────────────

function BarRow({ label, pnl, trades, wins, maxAbsPnl, baseCurrency = 'USD' }) {
  const pct = maxAbsPnl > 0 ? (Math.abs(pnl) / maxAbsPnl) * 100 : 0;
  const isPos = pnl >= 0;
  const wr = trades > 0 ? Math.round((wins / trades) * 100) : 0;
  return (
    <div className="flex items-center gap-3 py-2.5 border-b border-gray-50 last:border-0">
      <span className="w-16 text-xs font-medium text-gray-600 shrink-0">{label}</span>
      <div className="flex-1 bg-gray-100 rounded-full h-1.5 overflow-hidden">
        <div
          className={`h-1.5 rounded-full transition-all ${isPos ? 'bg-blue-500' : 'bg-red-400'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className={`text-xs font-semibold w-20 text-right shrink-0 ${isPos ? 'text-green-600' : 'text-red-500'}`}>
        <PrivacyValue value={fmtPnl(pnl, baseCurrency)} />
      </span>
      <span className="text-xs text-gray-400 w-24 text-right shrink-0">
        {trades}tr · {wr}% WR
      </span>
    </div>
  );
}

// ─── main component ────────────────────────────────────────────────────────────

export default function PerformanceScreen({ session }) {
  const userId = session?.user?.id;
  const navigate = useNavigate();
  const baseCurrency = useBaseCurrency();
  const [allTrades, setAllTrades] = useState([]);
  const [plansMap, setPlansMap] = useState({});
  const [loading, setLoading] = useState(true);

  // period control
  const [preset, setPreset] = useState('All');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');

  // by-symbol sort
  const [sortCol, setSortCol] = useState('pnl');
  const [sortDir, setSortDir] = useState('desc');

  // weekly reflection
  const weekKey = currentISOWeek();
  const [reflection, setReflection] = useState({ worked: '', didnt_work: '', recurring: '', action: '' });
  const [reflectionSaving, setReflectionSaving] = useState(false);
  const [reflectionSaved, setReflectionSaved] = useState(false);
  const [reflectionLoaded, setReflectionLoaded] = useState(false);

  useEffect(() => {
    if (!userId) return;
    // Fetch closed trades + plans together so we can compute adherence
    // breakdown per period on the fly (no reliance on stored adherence_score
    // which may be stale if plans were edited since last sync).
    // Using select('*') on logical_trades to keep the adherence calc
    // flexible — needs avg_entry_price, total_closing_quantity,
    // total_opening_quantity, planned_trade_id, direction, etc.
    Promise.all([
      supabase
        .from('logical_trades')
        .select('*')
        .eq('user_id', userId)
        .eq('status', 'closed'),
      supabase
        .from('planned_trades')
        .select('id, planned_entry_price, planned_target_price, planned_stop_loss, planned_quantity')
        .eq('user_id', userId),
      supabase
        .from('weekly_reviews')
        .select('worked, didnt_work, recurring, action')
        .eq('user_id', userId)
        .eq('week_key', weekKey)
        .maybeSingle(),
    ]).then(([tradesRes, plansRes, reviewRes]) => {
      setAllTrades(tradesRes.data || []);
      const map = {};
      for (const p of (plansRes.data || [])) map[p.id] = p;
      setPlansMap(map);
      if (reviewRes.data) {
        setReflection({
          worked: reviewRes.data.worked || '',
          didnt_work: reviewRes.data.didnt_work || '',
          recurring: reviewRes.data.recurring || '',
          action: reviewRes.data.action || '',
        });
      }
      setReflectionLoaded(true);
      setLoading(false);
    });
  }, [userId, weekKey]);

  const handleSaveReflection = useCallback(async () => {
    if (!userId || reflectionSaving) return;
    setReflectionSaving(true);
    const { error } = await supabase
      .from('weekly_reviews')
      .upsert({
        user_id: userId,
        week_key: weekKey,
        worked: reflection.worked.trim() || null,
        didnt_work: reflection.didnt_work.trim() || null,
        recurring: reflection.recurring.trim() || null,
        action: reflection.action.trim() || null,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id,week_key' });
    setReflectionSaving(false);
    if (error) {
      console.error('[perf] weekly reflection save failed:', error.message);
      alert(`Could not save reflection: ${error.message}`);
      return;
    }
    setReflectionSaved(true);
    setTimeout(() => setReflectionSaved(false), 3000);
  }, [userId, weekKey, reflection, reflectionSaving]);

  const handlePreset = (p) => {
    setPreset(p);
    setCustomFrom('');
    setCustomTo('');
  };

  const handleCustom = (from, to) => {
    setCustomFrom(from);
    setCustomTo(to);
    if (from || to) setPreset('');
  };

  // filtered trades by date window — compare date-only strings to avoid timezone/format issues
  const trades = useMemo(() => {
    const startDate = preset ? presetStartDate(preset) : (customFrom || null);
    const endDate   = (!preset && customTo) ? customTo : null;

    return allTrades.filter(t => {
      if (!t.closed_at) return false;
      // Normalise to YYYY-MM-DD regardless of whether Supabase returns a full timestamp
      const day = t.closed_at.slice(0, 10);
      if (startDate && day < startDate) return false;
      if (endDate   && day > endDate)   return false;
      return true;
    });
  }, [allTrades, preset, customFrom, customTo]);

  // ── KPI stats ──
  const stats = useMemo(() => {
    const n = trades.length;
    if (n === 0) return null;
    const winners = trades.filter(t => pnlBase(t) > 0);
    const losers  = trades.filter(t => pnlBase(t) <= 0);
    const grossW = winners.reduce((s, t) => s + pnlBase(t), 0);
    const grossL = losers.reduce((s, t) => s + pnlBase(t), 0);
    const avgWin = winners.length > 0 ? grossW / winners.length : 0;
    const avgLoss = losers.length > 0 ? Math.abs(grossL / losers.length) : 0;
    const wlRatio = avgLoss > 0 ? (avgWin / avgLoss).toFixed(2) : '∞';
    const winRate = Math.round((winners.length / n) * 100);
    const netPnl = grossW + grossL;
    const expectancy = netPnl / n;
    return { n, winners: winners.length, losers: losers.length, netPnl, winRate, wlRatio, avgWin, avgLoss, expectancy };
  }, [trades]);

  // ── adherence breakdown across the period ──
  // For every matched closed trade in the filtered period, compute the
  // 4-pillar breakdown and average each pillar separately. Null sub-scores
  // (plan didn't specify that field) are skipped per pillar.
  const adherenceStats = useMemo(() => {
    const sums = { entry: 0, target: 0, stop: 0, size: 0 };
    const counts = { entry: 0, target: 0, stop: 0, size: 0 };
    let matchedCount = 0;
    for (const t of trades) {
      if (t.matching_status !== 'matched' || !t.planned_trade_id) continue;
      const plan = plansMap[t.planned_trade_id];
      if (!plan) continue;
      const b = computeAdherenceBreakdown(plan, t);
      if (!b) continue;
      matchedCount++;
      for (const key of ['entry', 'target', 'stop', 'size']) {
        if (b[key] != null) { sums[key] += b[key]; counts[key]++; }
      }
    }
    if (matchedCount === 0) return null;
    const avg = (key) => counts[key] > 0 ? Math.round((sums[key] / counts[key]) * 10) / 10 : null;
    const pillars = { entry: avg('entry'), target: avg('target'), stop: avg('stop'), size: avg('size') };
    const scored = Object.values(pillars).filter(v => v != null);
    const overall = scored.length > 0
      ? Math.round((scored.reduce((a, b) => a + b, 0) / scored.length) * 10) / 10
      : null;
    return { ...pillars, overall, matchedCount };
  }, [trades, plansMap]);

  // ── cumulative curve data ──
  const curveData = useMemo(() => {
    const sorted = [...trades].sort((a, b) => (a.closed_at > b.closed_at ? 1 : -1));
    const dayMap = new Map();
    for (const t of sorted) {
      const day = t.closed_at.slice(0, 10);
      dayMap.set(day, (dayMap.get(day) || 0) + pnlBase(t));
    }
    const days = [...dayMap.entries()].sort(([a], [b]) => a.localeCompare(b));
    let cum = 0;
    return days.map(([day, dayPnl]) => {
      cum += dayPnl;
      return { date: day + 'T12:00:00Z', dayPnl, cumPnl: cum };
    });
  }, [trades]);

  // ── by-symbol ──
  const symbolRows = useMemo(() => {
    const map = new Map();
    for (const t of trades) {
      // OPT symbols from IBKR look like "NVDA 260330P00170000" — display only the underlying
      const raw = t.symbol || '?';
      const sym = t.asset_category === 'OPT' ? raw.split(' ')[0] : raw;
      if (!map.has(sym)) map.set(sym, { symbol: sym, trades: 0, wins: 0, pnl: 0 });
      const s = map.get(sym);
      s.trades++;
      s.pnl += pnlBase(t);
      if (pnlBase(t) > 0) s.wins++;
    }
    const rows = [...map.values()].map(s => ({
      ...s,
      winRate: s.trades > 0 ? Math.round((s.wins / s.trades) * 100) : 0,
    }));
    const mult = sortDir === 'asc' ? 1 : -1;
    rows.sort((a, b) => {
      if (sortCol === 'symbol') return mult * a.symbol.localeCompare(b.symbol);
      if (sortCol === 'trades') return mult * (a.trades - b.trades);
      if (sortCol === 'winRate') return mult * (a.winRate - b.winRate);
      return mult * (a.pnl - b.pnl); // pnl default
    });
    return rows;
  }, [trades, sortCol, sortDir]);

  const handleSort = (col) => {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortCol(col); setSortDir('desc'); }
  };

  // ── by-direction ──
  const dirRows = useMemo(() => {
    const map = {};
    for (const t of trades) {
      const k = t.direction || 'UNKNOWN';
      if (!map[k]) map[k] = { label: k, trades: 0, wins: 0, pnl: 0 };
      map[k].trades++;
      map[k].pnl += pnlBase(t);
      if (pnlBase(t) > 0) map[k].wins++;
    }
    return Object.values(map).sort((a, b) => b.pnl - a.pnl);
  }, [trades]);

  // ── by-asset-class ──
  const assetRows = useMemo(() => {
    const map = {};
    for (const t of trades) {
      const k = t.asset_category || 'OTHER';
      if (!map[k]) map[k] = { label: k, trades: 0, wins: 0, pnl: 0 };
      map[k].trades++;
      map[k].pnl += pnlBase(t);
      if (pnlBase(t) > 0) map[k].wins++;
    }
    return Object.values(map).sort((a, b) => b.pnl - a.pnl);
  }, [trades]);

  const maxDirAbs = Math.max(...dirRows.map(r => Math.abs(r.pnl)), 1);
  const maxAssetAbs = Math.max(...assetRows.map(r => Math.abs(r.pnl)), 1);

  // ── by-day-of-week ──
  const dayOfWeekRows = useMemo(() => {
    const buckets = {};
    for (const t of trades) {
      if (!t.closed_at) continue;
      const day = new Date(t.closed_at).getDay(); // 0=Sun … 6=Sat
      const label = DAY_LABELS[day];
      if (!buckets[label]) buckets[label] = { label, trades: 0, wins: 0, pnl: 0, sortKey: day };
      buckets[label].trades++;
      buckets[label].pnl += pnlBase(t);
      if (pnlBase(t) > 0) buckets[label].wins++;
    }
    return Object.values(buckets).sort((a, b) => a.sortKey - b.sortKey);
  }, [trades]);

  // ── by-hour-of-day ──
  const hourOfDayRows = useMemo(() => {
    const buckets = {};
    for (const t of trades) {
      if (!t.closed_at) continue;
      const hour = new Date(t.closed_at).getHours();
      const label = `${hour.toString().padStart(2, '0')}:00`;
      if (!buckets[label]) buckets[label] = { label, trades: 0, wins: 0, pnl: 0, sortKey: hour };
      buckets[label].trades++;
      buckets[label].pnl += pnlBase(t);
      if (pnlBase(t) > 0) buckets[label].wins++;
    }
    return Object.values(buckets).sort((a, b) => a.sortKey - b.sortKey);
  }, [trades]);

  const maxDayAbs = Math.max(...dayOfWeekRows.map(r => Math.abs(r.pnl)), 1);
  const maxHourAbs = Math.max(...hourOfDayRows.map(r => Math.abs(r.pnl)), 1);

  // ── auto-generated callouts ──
  // Deterministic rules that fire when the data shows something notable.
  // Returns an array of { type: 'positive'|'warning'|'insight', text: string }.
  const callouts = useMemo(() => {
    const results = [];
    if (!stats || trades.length < 3) return results;

    // Rule 1: Standout symbol (high win rate with enough trades)
    const standout = symbolRows.find(s => s.trades >= 3 && s.winRate >= 80);
    if (standout) {
      results.push({
        type: 'positive',
        text: `${standout.symbol}: ${standout.winRate}% win rate across ${standout.trades} trades${standout.pnl > 0 ? ` (${fmtPnl(standout.pnl, baseCurrency)})` : ''}.`,
      });
    }

    // Rule 2: Worst symbol (net loss with enough trades)
    const worst = [...symbolRows].sort((a, b) => a.pnl - b.pnl)[0];
    if (worst && worst.pnl < 0 && worst.trades >= 2) {
      results.push({
        type: 'warning',
        text: `${worst.symbol}: net ${fmtPnl(worst.pnl, baseCurrency)} across ${worst.trades} trades — your biggest drag.`,
      });
    }

    // Rule 3: Adherence entry vs target comparison (weak pillar)
    if (adherenceStats) {
      const pillars = [
        { key: 'entry', label: 'Entry timing' },
        { key: 'target', label: 'Target capture' },
        { key: 'stop', label: 'Stop discipline' },
        { key: 'size', label: 'Position sizing' },
      ];
      const weakest = pillars
        .filter(p => adherenceStats[p.key] != null)
        .sort((a, b) => adherenceStats[a.key] - adherenceStats[b.key])[0];
      if (weakest && adherenceStats[weakest.key] < 70) {
        results.push({
          type: 'warning',
          text: `${weakest.label} is your weakest discipline at ${Math.round(adherenceStats[weakest.key])} — focus here for the biggest improvement.`,
        });
      }
    }

    // Rule 4: Day-of-week outlier (worst day)
    if (dayOfWeekRows.length >= 3) {
      const worstDay = [...dayOfWeekRows].sort((a, b) => a.pnl - b.pnl)[0];
      if (worstDay && worstDay.pnl < 0 && worstDay.trades >= 2) {
        results.push({
          type: 'insight',
          text: `${worstDay.label} is your worst day: ${fmtPnl(worstDay.pnl, baseCurrency)} across ${worstDay.trades} trades.`,
        });
      }
    }

    // Rule 5: Off-plan trading signal
    // Counts both the new 'off_plan' status (auto-detected 0 candidates) and
    // the legacy manual+!hasPlan representation (user confirmed "no plan" in review).
    const offPlanCount = trades.filter(t =>
      t.matching_status === 'off_plan' || (t.matching_status === 'manual' && !t.planned_trade_id)
    ).length;
    if (offPlanCount > 0 && trades.length > 0) {
      const pct = Math.round((offPlanCount / trades.length) * 100);
      if (pct >= 30) {
        results.push({
          type: 'warning',
          text: `${offPlanCount} of ${trades.length} trades (${pct}%) were off-plan — consider writing plans before entering.`,
        });
      }
    }

    // Rule 6: Strong overall performance
    if (stats.winRate >= 60 && stats.netPnl > 0) {
      results.push({
        type: 'positive',
        text: `Strong overall performance: ${stats.winRate}% win rate across ${stats.n} trades.`,
      });
    }

    return results;
  }, [trades, stats, symbolRows, adherenceStats, dayOfWeekRows, baseCurrency]);

  // ── chart domain ──
  const allCumVals = curveData.map(d => d.cumPnl);
  const yMin = Math.min(0, ...allCumVals);
  const yMax = Math.max(0, ...allCumVals);
  const yPad = Math.max((yMax - yMin) * 0.1, 50);

  if (loading) {
    return (
      <div className="animate-pulse">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
              <div className="h-3 bg-gray-200 rounded w-20 mb-3" />
              <div className="h-7 bg-gray-200 rounded w-24 mb-1" />
              <div className="h-3 bg-gray-200 rounded w-16" />
            </div>
          ))}
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 mb-6">
          <div className="h-4 bg-gray-200 rounded w-32 mb-4" />
          <div className="h-48 bg-gray-100 rounded-lg" />
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="flex items-center space-x-4 px-5 py-4 border-b border-gray-50 last:border-0">
              <div className="h-4 bg-gray-200 rounded w-16" />
              <div className="h-4 bg-gray-200 rounded w-12" />
              <div className="h-4 bg-gray-200 rounded w-12" />
              <div className="h-4 bg-gray-200 rounded w-20 ml-auto" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  const kpis = [
    {
      label: 'Net P&L',
      value: stats ? fmtPnl(stats.netPnl, baseCurrency) : '—',
      sub: stats ? `${stats.n} closed trades` : 'No data',
      color: stats ? (stats.netPnl >= 0 ? 'text-green-600' : 'text-red-500') : 'text-gray-400',
      maskValue: true,
    },
    {
      label: 'Win rate',
      value: stats ? `${stats.winRate}%` : '—',
      sub: stats ? `${stats.winners}W · ${stats.losers}L` : 'No data',
      color: stats ? 'text-gray-900' : 'text-gray-400',
      maskValue: false,
    },
    {
      label: 'Avg W / L',
      value: stats ? `${stats.wlRatio}` : '—',
      sub: stats ? `${fmtPnl(stats.avgWin, baseCurrency)} / ${fmtPnl(-stats.avgLoss, baseCurrency)}` : 'No data',
      color: stats ? 'text-gray-900' : 'text-gray-400',
      maskValue: false,
      maskSub: true,
    },
    {
      label: 'Expectancy',
      value: stats ? fmtPnl(stats.expectancy, baseCurrency) : '—',
      sub: 'per trade',
      color: stats ? (stats.expectancy >= 0 ? 'text-green-600' : 'text-red-500') : 'text-gray-400',
      maskValue: true,
    },
    {
      label: 'Avg adherence',
      value: adherenceStats ? `${Math.round(adherenceStats.overall)}` : '—',
      sub: adherenceStats ? `${adherenceStats.matchedCount} matched trade${adherenceStats.matchedCount !== 1 ? 's' : ''}` : 'No matched trades',
      color: adherenceStats
        ? (adherenceStats.overall >= 75 ? 'text-green-600'
          : adherenceStats.overall >= 50 ? 'text-amber-600'
          : 'text-red-500')
        : 'text-gray-400',
      maskValue: false,
      onClick: () => document.getElementById('adherence-breakdown')?.scrollIntoView({ behavior: 'smooth' }),
    },
  ];

  const SYM_COLS = [
    { key: 'symbol', label: 'Symbol' },
    { key: 'trades', label: 'Trades' },
    { key: 'winRate', label: 'Win rate' },
    { key: 'pnl', label: 'Net P&L' },
  ];

  return (
    <div className="space-y-6" style={{}}>

      {/* ── header + period controls ── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <h2 className="text-xl font-semibold text-gray-900">Performance</h2>
        <div className="flex flex-wrap items-center gap-2">
          {PRESETS.map(p => (
            <button
              key={p}
              onClick={() => handlePreset(p)}
              className={`text-xs font-medium px-4 py-1.5 rounded-full border transition-colors whitespace-nowrap ${
                preset === p
                  ? 'bg-blue-600 text-white border-transparent'
                  : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
              }`}
            >
              {p}
            </button>
          ))}
          <span className="text-gray-200 text-sm">|</span>
          <input
            type="date"
            value={customFrom}
            onChange={e => handleCustom(e.target.value, customTo)}
            className={`text-xs px-3 py-1.5 rounded-full border transition-colors focus:outline-none focus:ring-2 focus:ring-blue-400 ${
              !preset ? 'border-blue-400 bg-blue-50' : 'border-gray-200 bg-white text-gray-600'
            }`}
          />
          <span className="text-xs text-gray-400">→</span>
          <input
            type="date"
            value={customTo}
            onChange={e => handleCustom(customFrom, e.target.value)}
            className={`text-xs px-3 py-1.5 rounded-full border transition-colors focus:outline-none focus:ring-2 focus:ring-blue-400 ${
              !preset ? 'border-blue-400 bg-blue-50' : 'border-gray-200 bg-white text-gray-600'
            }`}
          />
        </div>
      </div>

      {/* ── KPI cards ── */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        {kpis.map(card => (
          <div
            key={card.label}
            onClick={card.onClick || undefined}
            className={`bg-white rounded-2xl p-5 shadow-sm border border-gray-100 ${
              card.onClick ? 'cursor-pointer hover:border-blue-200 hover:shadow-md transition-all' : ''
            }`}
          >
            <p className="text-xs font-medium text-gray-400 mb-1.5">{card.label}</p>
            <p className={`text-2xl font-semibold leading-none mb-1 ${card.color}`}>
              {card.maskValue ? <PrivacyValue value={card.value} /> : card.value}
            </p>
            <p className="text-xs text-gray-400">
              {card.maskSub ? <PrivacyValue value={card.sub} /> : card.sub}
            </p>
          </div>
        ))}
      </div>

      {/* ── auto callouts ── */}
      {callouts.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {callouts.map((c, i) => {
            const styles = {
              positive: 'bg-green-50 border-green-200 text-green-800',
              warning:  'bg-amber-50 border-amber-200 text-amber-800',
              insight:  'bg-blue-50 border-blue-200 text-blue-800',
            };
            const icons = {
              positive: (
                <svg className="w-4 h-4 text-green-600 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              ),
              warning: (
                <svg className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              ),
              insight: (
                <svg className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              ),
            };
            return (
              <div key={i} className={`flex items-start gap-2.5 rounded-xl border px-4 py-3 text-sm ${styles[c.type]}`}>
                {icons[c.type]}
                <span>{c.text}</span>
              </div>
            );
          })}
        </div>
      )}

      {/* ── cumulative P&L curve ── */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
        <h3 className="text-sm font-semibold text-gray-700 mb-4">Cumulative P&L</h3>
        {curveData.length < 2 ? (
          <div className="flex items-center justify-center h-48 text-sm text-gray-400">
            Not enough data to plot a curve
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={curveData} margin={{ top: 4, right: 16, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
              <XAxis
                dataKey="date"
                tickFormatter={fmtDay}
                tick={{ fontSize: 11, fill: '#9ca3af' }}
                axisLine={false}
                tickLine={false}
                minTickGap={40}
              />
              <YAxis
                tickFormatter={(n) => fmtShort(n, baseCurrency)}
                tick={{ fontSize: 11, fill: '#9ca3af' }}
                axisLine={false}
                tickLine={false}
                domain={[yMin - yPad, yMax + yPad]}
                width={52}
              />
              <Tooltip content={<CurveTip baseCurrency={baseCurrency} />} cursor={{ stroke: '#e5e7eb', strokeWidth: 1 }} />
              <Line
                type="monotone"
                dataKey="cumPnl"
                stroke="#2563eb"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4, fill: '#2563eb', stroke: '#fff', strokeWidth: 2 }}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* ── adherence decomposition ── */}
      <div id="adherence-breakdown" className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-sm font-semibold text-gray-700">Adherence breakdown</h3>
            <p className="text-xs text-gray-400 mt-0.5">
              Where is your discipline strongest — and where are you slipping?
            </p>
          </div>
          {adherenceStats && (
            <div className="text-right">
              <p className="text-xs text-gray-400">Overall</p>
              <p className={`text-2xl font-semibold leading-none ${
                adherenceStats.overall >= 75 ? 'text-green-600'
                : adherenceStats.overall >= 50 ? 'text-amber-600'
                : 'text-red-500'
              }`}>
                {Math.round(adherenceStats.overall)}
              </p>
            </div>
          )}
        </div>

        {!adherenceStats ? (
          <p className="text-sm text-gray-400 text-center py-8">
            No matched trades in this period — create plans and link them to your trades to see your adherence breakdown.
          </p>
        ) : (
          <div className="space-y-3">
            {[
              { key: 'entry',  label: 'Entry',    help: 'How close to your planned entry price' },
              { key: 'target', label: 'Target',   help: 'How much of the planned move you captured' },
              { key: 'stop',   label: 'Stop',     help: 'Whether stops were respected' },
              { key: 'size',   label: 'Size',     help: 'How close to your planned quantity' },
            ].map(({ key, label, help }) => {
              const score = adherenceStats[key];
              const scored = score != null;
              const color = !scored ? 'bg-gray-200'
                : score >= 75 ? 'bg-green-500'
                : score >= 50 ? 'bg-amber-500'
                : 'bg-red-500';
              const textColor = !scored ? 'text-gray-300'
                : score >= 75 ? 'text-green-700'
                : score >= 50 ? 'text-amber-700'
                : 'text-red-600';
              return (
                <div key={key} className="flex items-center gap-3">
                  <div className="w-20 shrink-0">
                    <p className="text-xs font-semibold text-gray-700">{label}</p>
                    <p className="text-[10px] text-gray-400 leading-tight">{help}</p>
                  </div>
                  <div className="flex-1 bg-gray-100 rounded-full h-2 overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${color}`}
                      style={{ width: scored ? `${score}%` : '0%' }}
                    />
                  </div>
                  <span className={`text-sm font-semibold w-10 text-right shrink-0 ${textColor}`}>
                    {scored ? Math.round(score) : '—'}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── by-symbol table ── */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100">
          <h3 className="text-sm font-semibold text-gray-700">By symbol</h3>
        </div>
        {symbolRows.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-12">No closed trades in this period</p>
        ) : (
          <>
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  {SYM_COLS.map(col => (
                    <th
                      key={col.key}
                      onClick={() => handleSort(col.key)}
                      className="px-3 sm:px-5 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer select-none hover:text-gray-700 whitespace-nowrap"
                    >
                      {col.label}
                      {sortIcon(sortCol === col.key, sortDir)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {symbolRows.slice(0, 20).map(row => {
                  // Map Performance period → Journal date-range filter
                  const periodMap = { '1W': '1w', '1M': '1m', '3M': '3m', 'All': 'all' };
                  let dateFilter;
                  if (preset === '1D') {
                    const today = new Date().toISOString().slice(0, 10);
                    dateFilter = { dateRange: 'custom', customFrom: today, customTo: today };
                  } else if (preset && periodMap[preset]) {
                    dateFilter = { dateRange: periodMap[preset] };
                  } else if (!preset && (customFrom || customTo)) {
                    dateFilter = { dateRange: 'custom', customFrom, customTo };
                  } else {
                    dateFilter = { dateRange: 'all' };
                  }
                  return (
                  <tr
                    key={row.symbol}
                    onClick={() => navigate('/journal', { state: { symbolFilter: row.symbol, ...dateFilter } })}
                    className="hover:bg-blue-50 cursor-pointer transition-colors"
                    title={`View ${row.symbol} trades in Smart Journal`}
                  >
                    <td className="px-3 sm:px-5 py-3.5 text-sm font-semibold text-blue-600 whitespace-nowrap">{row.symbol}</td>
                    <td className="px-3 sm:px-5 py-3.5 text-sm text-gray-600">{row.trades}</td>
                    <td className="px-3 sm:px-5 py-3.5 text-sm text-gray-700">{row.winRate}%</td>
                    <td className={`px-3 sm:px-5 py-3.5 text-sm font-semibold whitespace-nowrap ${row.pnl >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                      <PrivacyValue value={fmtPnl(row.pnl, baseCurrency)} />
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
            {symbolRows.length > 20 && (
              <p className="text-center text-xs text-gray-400 py-3 border-t border-gray-100">
                Showing top 20 of {symbolRows.length} · sort columns to re-rank
              </p>
            )}
          </>
        )}
      </div>

      {/* ── by-direction + by-asset-class ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">By direction</h3>
          {dirRows.length === 0 ? (
            <p className="text-sm text-gray-400 py-4 text-center">No data</p>
          ) : (
            dirRows.map(r => (
              <BarRow key={r.label} {...r} maxAbsPnl={maxDirAbs} baseCurrency={baseCurrency} />
            ))
          )}
        </div>
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">By asset class</h3>
          {assetRows.length === 0 ? (
            <p className="text-sm text-gray-400 py-4 text-center">No data</p>
          ) : (
            assetRows.map(r => (
              <BarRow key={r.label} {...r} maxAbsPnl={maxAssetAbs} baseCurrency={baseCurrency} />
            ))
          )}
        </div>
      </div>

      {/* ── by-day-of-week + by-hour-of-day ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
          <h3 className="text-sm font-semibold text-gray-700 mb-1">By day of week</h3>
          <p className="text-xs text-gray-400 mb-3">Which days are you most profitable on?</p>
          {dayOfWeekRows.length === 0 ? (
            <p className="text-sm text-gray-400 py-4 text-center">No data</p>
          ) : (
            dayOfWeekRows.map(r => (
              <BarRow key={r.label} {...r} maxAbsPnl={maxDayAbs} baseCurrency={baseCurrency} />
            ))
          )}
        </div>
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
          <h3 className="text-sm font-semibold text-gray-700 mb-1">By hour of day</h3>
          <p className="text-xs text-gray-400 mb-3">Are you sharper at certain times?</p>
          {hourOfDayRows.length === 0 ? (
            <p className="text-sm text-gray-400 py-4 text-center">No data</p>
          ) : (
            hourOfDayRows.map(r => (
              <BarRow key={r.label} {...r} maxAbsPnl={maxHourAbs} baseCurrency={baseCurrency} />
            ))
          )}
        </div>
      </div>

      {/* ── weekly reflection ── */}
      {reflectionLoaded && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-semibold text-gray-700">Weekly reflection</h3>
              <p className="text-xs text-gray-400 mt-0.5">Week {weekKey}</p>
            </div>
            <button
              onClick={handleSaveReflection}
              disabled={reflectionSaving}
              className={`text-xs font-semibold px-4 py-1.5 rounded-lg transition-all ${
                reflectionSaved
                  ? 'bg-green-500 text-white'
                  : 'bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60'
              }`}
            >
              {reflectionSaved ? '✓ Saved' : reflectionSaving ? 'Saving…' : 'Save'}
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {[
              { key: 'worked',     label: 'What worked well this week?',        placeholder: 'e.g. Stuck to entries on planned trades, cut losers fast…' },
              { key: 'didnt_work', label: "What didn't work?",                  placeholder: 'e.g. Chased entries on NVDA, oversized on impulse…' },
              { key: 'recurring',  label: 'Is this a recurring pattern?',       placeholder: 'e.g. Third week in a row exiting too early on winners…' },
              { key: 'action',     label: 'Action for next week',               placeholder: 'e.g. Set alerts at planned entry, no trades before 10am…' },
            ].map(({ key, label, placeholder }) => (
              <div key={key}>
                <label className="block text-xs font-semibold text-gray-500 mb-1.5">{label}</label>
                <textarea
                  value={reflection[key]}
                  onChange={e => setReflection(prev => ({ ...prev, [key]: e.target.value }))}
                  placeholder={placeholder}
                  rows={3}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-gray-50 text-gray-900 placeholder-gray-300 resize-none"
                />
              </div>
            ))}
          </div>
        </div>
      )}

    </div>
  );
}

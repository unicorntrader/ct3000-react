import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import * as Sentry from '@sentry/react';
import { supabase } from '../lib/supabaseClient';
import { pnlBase, fmtPnl, fmtShort, fmtSymbol } from '../lib/formatters';
import { useBaseCurrency } from '../lib/BaseCurrencyContext';
import { useDataVersion, useInitialLoadTracker } from '../lib/DataVersionContext';
import PrivacyValue from '../components/PrivacyValue';
import LoadError from '../components/LoadError';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';

// ─── helpers ──────────────────────────────────────────────────────────────────

const PRESETS = ['1D', '1W', '1M', '3M', 'All'];

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
  const location = useLocation();
  const baseCurrency = useBaseCurrency();
  const [allTrades, setAllTrades] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);

  // period control — initialize from location.state so "Back to Performance"
  // from Journal can restore the period the user was looking at.
  const [preset, setPreset] = useState(() => {
    const s = location.state;
    if (s && (s.preset !== undefined || s.customFrom || s.customTo)) {
      return s.preset ?? '';
    }
    return 'All';
  });
  const [customFrom, setCustomFrom] = useState(() => location.state?.customFrom || '');
  const [customTo, setCustomTo] = useState(() => location.state?.customTo || '');

  // Clear the restored state so a hard reload doesn't re-apply stale period.
  useEffect(() => {
    if (location.state && (location.state.preset !== undefined || location.state.customFrom || location.state.customTo)) {
      navigate(location.pathname, { replace: true, state: {} });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // by-symbol sort
  const [sortCol, setSortCol] = useState('pnl');
  const [sortDir, setSortDir] = useState('desc');

  // Which callouts are expanded to show their "why / action" panel.
  // Stored as a Set of indexes so multiple can be open at once.
  const [expandedCallouts, setExpandedCallouts] = useState(() => new Set());
  const toggleCallout = useCallback((i) => {
    setExpandedCallouts(prev => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }, []);

  // weekly reflection
  const weekKey = currentISOWeek();
  const [reflection, setReflection] = useState({ worked: '', didnt_work: '', recurring: '', action: '' });
  const [reflectionSaving, setReflectionSaving] = useState(false);
  const [reflectionSaved, setReflectionSaved] = useState(false);
  const [reflectionLoaded, setReflectionLoaded] = useState(false);

  // Cross-screen data invalidation — refetch silently when watched tables
  // are mutated elsewhere. See lib/DataVersionContext for the key map.
  const [tradesV] = useDataVersion('trades');
  const loadTracker = useInitialLoadTracker(reloadKey);

  useEffect(() => {
    if (!userId) return;
    // Load closed trades for the period + this week's reflection row.
    // adherence_score is read directly off each logical_trade (written by
    // api/rebuild.js). We no longer load planned_trades here — with matched
    // plans locked in the UI, the stored adherence can't go stale.
    const isInitial = loadTracker.isInitial;
    if (isInitial) setLoading(true);
    setLoadError(null);
    (async () => {
      try {
        const [tradesRes, reviewRes] = await Promise.all([
          supabase
            .from('logical_trades')
            .select('*')
            .eq('user_id', userId)
            .eq('status', 'closed'),
          supabase
            .from('weekly_reviews')
            .select('worked, didnt_work, recurring, action')
            .eq('user_id', userId)
            .eq('week_key', weekKey)
            .maybeSingle(),
        ]);
        if (tradesRes.error) throw tradesRes.error;
        // weekly_reviews.maybeSingle() returns error: null + data: null when no row
        // exists — that's the expected "no weekly review yet" path, not a failure.
        if (reviewRes.error) throw reviewRes.error;
        setAllTrades(tradesRes.data || []);
        if (reviewRes.data) {
          setReflection({
            worked: reviewRes.data.worked || '',
            didnt_work: reviewRes.data.didnt_work || '',
            recurring: reviewRes.data.recurring || '',
            action: reviewRes.data.action || '',
          });
        }
        setReflectionLoaded(true);
      } catch (err) {
        console.error('[performance] load failed:', err?.message || err);
        Sentry.withScope((scope) => {
          scope.setTag('screen', 'performance');
          scope.setTag('step', 'load');
          scope.setTag('load_kind', isInitial ? 'initial' : 'silent-refetch');
          Sentry.captureException(err instanceof Error ? err : new Error(String(err)));
        });
        if (isInitial) setLoadError(err?.message || 'Could not load performance data.');
      } finally {
        if (isInitial) setLoading(false);
        loadTracker.markLoaded();
      }
    })();
  }, [userId, weekKey, reloadKey, tradesV]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // ── avg adherence across the period ──
  // Reads the stored adherence_score column directly. No client-side recompute.
  // api/rebuild.js writes adherence_score for every matched closed trade, so
  // any null value means the trade was open, unmatched, or predates the
  // computation code path (one manual /api/rebuild fixes it).
  const adherenceStats = useMemo(() => {
    let sum = 0;
    let scored = 0;
    let matchedCount = 0;
    for (const t of trades) {
      if (t.matching_status !== 'matched') continue;
      matchedCount++;
      if (t.adherence_score != null) {
        sum += t.adherence_score;
        scored++;
      }
    }
    if (scored === 0) return null;
    return {
      overall: Math.round((sum / scored) * 10) / 10,
      matchedCount,
    };
  }, [trades]);

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

  // ── auto-generated callouts ──
  // Deterministic rules that fire when the data shows something notable.
  // Returns an array of:
  //   { type: 'positive'|'warning'|'insight', text, why, action }
  // where `text` is the short one-liner with evidence (collapsed view) and
  // `why` / `action` power the expanded "learn from this" panel.
  //
  // Rules are grouped into three tiers:
  //   1-5   Symbol & discipline signals (need ≥3 trades)
  //   6-7   Day-of-week patterns        (need ≥3 trades on that weekday)
  //   8-12  Behavioural / overtrading   (need chronology, some need ≥5 days)
  //
  // Thresholds are personalised where possible (e.g. overtrading uses the
  // user's own median daily trade count) so a scalper and a swing trader
  // both get meaningful signal.
  const callouts = useMemo(() => {
    const results = [];
    if (!stats || trades.length < 3) return results;

    // ─── SYMBOL & DISCIPLINE ────────────────────────────────────────────────

    // 1. Standout symbol — high WR with enough sample size
    const standout = symbolRows.find(s => s.trades >= 3 && s.winRate >= 80);
    if (standout) {
      results.push({
        type: 'positive',
        text: `${standout.symbol}: ${standout.winRate}% win rate across ${standout.trades} trades${standout.pnl > 0 ? ` (${fmtPnl(standout.pnl, baseCurrency)})` : ''}.`,
        why: 'A symbol where you have a real edge — enough trades to trust the signal, and you\'re winning most of them. Concentration here is working in your favour.',
        action: 'Study what\'s different about how you play this one — setup, timing, sizing. That pattern may be repeatable on similar names.',
      });
    }

    // 2. Worst symbol — biggest net drag
    const worst = [...symbolRows].sort((a, b) => a.pnl - b.pnl)[0];
    if (worst && worst.pnl < 0 && worst.trades >= 2) {
      results.push({
        type: 'warning',
        text: `${worst.symbol}: net ${fmtPnl(worst.pnl, baseCurrency)} across ${worst.trades} trades — your biggest drag.`,
        why: 'A symbol that\'s consistently costing you money across multiple trades. Could be a poor setup fit, wrong timeframe, or you keep taking the same trade hoping for a different outcome.',
        action: 'Review your entries on this one. Either find the rule that excludes the losing setup, or drop it from the watchlist for a few weeks.',
      });
    }

    // 3. Adherence drift
    if (adherenceStats && adherenceStats.overall < 70) {
      results.push({
        type: 'warning',
        text: `Avg adherence is ${Math.round(adherenceStats.overall)} across ${adherenceStats.matchedCount} matched trade${adherenceStats.matchedCount !== 1 ? 's' : ''} — plans and execution are drifting apart.`,
        why: 'Adherence measures how closely your actual executions match the plan (entry, stop, target, size). A low score means plans aren\'t guiding behaviour — you\'re improvising in the moment.',
        action: 'For the next few trades, screenshot the plan before entering. After the trade, compare side-by-side. Either the plan needs fixing, or the discipline does.',
      });
    }

    // 4. Off-plan share
    const offPlanCount = trades.filter(t => t.matching_status === 'off_plan').length;
    if (offPlanCount > 0) {
      const pct = Math.round((offPlanCount / trades.length) * 100);
      if (pct >= 30) {
        results.push({
          type: 'warning',
          text: `${offPlanCount} of ${trades.length} trades (${pct}%) were off-plan — consider writing plans before entering.`,
          why: 'A significant share of trades has no written plan. Without a plan there\'s no reference point for review, no way to measure adherence, and no hypothesis to test — every trade is an experiment you can\'t learn from.',
          action: 'Require yourself to write a plan before every entry. One line is enough: setup, entry, stop, target. If you can\'t write it, you probably shouldn\'t take it.',
        });
      }
    }

    // 5. Strong overall performance
    if (stats.winRate >= 60 && stats.netPnl > 0) {
      results.push({
        type: 'positive',
        text: `Strong overall performance: ${stats.winRate}% win rate across ${stats.n} trades.`,
        why: 'Win rate above 60% with positive net P&L — you\'re executing a real edge. This is also the dangerous moment where confidence can slip into complacency.',
        action: 'Open Weekly Review and write down exactly what\'s working. Codify the rules that got you here — this is when to tighten discipline, not loosen it.',
      });
    }

    // ─── CHRONOLOGY-DEPENDENT HELPERS ───────────────────────────────────────
    // Sort closed trades by close time. Used by rules 6–12.

    const chrono = [...trades]
      .filter(t => t.closed_at)
      .sort((a, b) => (a.closed_at > b.closed_at ? 1 : -1));

    // Daily P&L + count buckets (keyed by YYYY-MM-DD of close)
    const byDay = new Map();
    for (const t of chrono) {
      const day = t.closed_at.slice(0, 10);
      if (!byDay.has(day)) byDay.set(day, { count: 0, pnl: 0 });
      const b = byDay.get(day);
      b.count += 1;
      b.pnl += pnlBase(t);
    }

    // ─── DAY-OF-WEEK ────────────────────────────────────────────────────────

    const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const dowBuckets = Array.from({ length: 7 }, () => ({ trades: 0, wins: 0, pnl: 0 }));
    for (const t of chrono) {
      const d = new Date(t.closed_at).getDay();
      dowBuckets[d].trades += 1;
      dowBuckets[d].pnl += pnlBase(t);
      if (pnlBase(t) > 0) dowBuckets[d].wins += 1;
    }
    const dowEligible = dowBuckets
      .map((b, i) => ({ ...b, dow: i, wr: b.trades > 0 ? Math.round((b.wins / b.trades) * 100) : 0 }))
      .filter(b => b.trades >= 3);

    if (dowEligible.length >= 2) {
      const dowBest = [...dowEligible].sort((a, b) => b.pnl - a.pnl)[0];
      const dowWorst = [...dowEligible].sort((a, b) => a.pnl - b.pnl)[0];

      // 6. Best day of the week
      if (dowBest.pnl > 0 && dowBest.wr >= 60) {
        results.push({
          type: 'positive',
          text: `${DOW[dowBest.dow]}s are your strongest day — ${dowBest.wr}% WR, ${fmtPnl(dowBest.pnl, baseCurrency)} across ${dowBest.trades} trades.`,
          why: 'You perform noticeably better on this weekday. Likely explanations: a weekly catalyst (earnings, macro release), a recurring market regime (Monday trend, Friday chop), or simply you\'re mentally fresher on that day.',
          action: 'Figure out the why, then lean into it — prepare harder for this day and consider thinning out your activity on the weakest ones.',
        });
      }

      // 7. Worst day of the week (skip if same as best)
      if (dowWorst.dow !== dowBest.dow && dowWorst.pnl < 0) {
        results.push({
          type: 'warning',
          text: `${DOW[dowWorst.dow]}s are dragging you down — ${fmtPnl(dowWorst.pnl, baseCurrency)} across ${dowWorst.trades} trades.`,
          why: 'This weekday is a consistent drag on P&L. Common culprits: end-of-week fatigue, range-bound markets with low-quality setups, or boredom trading when nothing is moving.',
          action: 'Try skipping this day for 2 weeks and compare. If total P&L goes up, you\'ve found a free return — fewer trades, more profit.',
        });
      }
    }

    // ─── BEHAVIOURAL / OVERTRADING ──────────────────────────────────────────

    // 8. Loss streak (≥3 consecutive losses anywhere in the period)
    let maxLossStreak = 0;
    let curStreak = 0;
    for (const t of chrono) {
      if (pnlBase(t) < 0) {
        curStreak += 1;
        if (curStreak > maxLossStreak) maxLossStreak = curStreak;
      } else {
        curStreak = 0;
      }
    }
    if (maxLossStreak >= 3) {
      results.push({
        type: 'warning',
        text: `Longest losing streak this period: ${maxLossStreak} trades in a row. A "step off after 2 losses" rule can protect equity.`,
        why: 'Three or more consecutive losses erode more than capital — they distort confidence, nudge you to oversize the next trade to "get it back", and open the door to revenge trades. Streaks compound psychologically.',
        action: 'Pre-commit to a hard stop: after 2 losing trades in a session, walk away for an hour. Review charts later with a clear head. The market will still be there.',
      });
    }

    // 9. Revenge trading — a real revenge trade is:
    //      (a) opened within 60 min of closing a losing trade, AND
    //      (b) UNPLANNED (off_plan) — planned entries aren't revenge, they're scheduled
    //    Sizing up is a common amplifier ("double down to get it back") so we
    //    track it separately and mention it if it happens. Exposure is
    //    qty × multiplier × avg_entry_price × fx-to-base so options and
    //    cross-currency trades compare on equal footing.
    //    Orphans (null opened_at) are skipped — we can't time their entry.
    const exposureOf = (t) => {
      const qty = parseFloat(t.total_opening_quantity) || parseFloat(t.total_closing_quantity) || 0;
      const mult = parseFloat(t.multiplier) || 1;
      const price = parseFloat(t.avg_entry_price) || 0;
      const fx = parseFloat(t.fx_rate_to_base) || 1;
      return Math.abs(qty * mult * price * fx);
    };
    let revengeCount = 0;
    let sizedUpCount = 0;
    for (let i = 0; i < chrono.length - 1; i++) {
      const t = chrono[i];
      if (pnlBase(t) >= 0) continue;
      const next = chrono[i + 1];
      if (!next.opened_at) continue;
      if (next.matching_status !== 'off_plan') continue;
      const gapMin = (new Date(next.opened_at) - new Date(t.closed_at)) / 60000;
      if (gapMin > 0 && gapMin <= 60) {
        revengeCount += 1;
        const losingExp = exposureOf(t);
        const nextExp = exposureOf(next);
        if (losingExp > 0 && nextExp > losingExp * 1.25) sizedUpCount += 1;
      }
    }
    if (revengeCount >= 2) {
      const sizeNote = sizedUpCount >= 1
        ? ` (${sizedUpCount} with bigger size — doubling down)`
        : '';
      results.push({
        type: 'warning',
        text: `${revengeCount} unplanned trade${revengeCount > 1 ? 's' : ''} opened within an hour of a loss${sizeNote} — revenge pattern. A 30-minute cool-off helps.`,
        why: 'Revenge trading is entering an unplanned trade right after a loss — often sized larger — to "get it back". It\'s emotion-driven, not edge-driven. The evidence across trading literature and our own data is consistent: these trades deepen the hole rather than recover it.',
        action: 'Set a hard rule: after any losing trade, no new entry for 30 minutes. If the idea still looks good after the cool-off, it was probably real. If not, you just dodged a tilt trade.',
      });
    }

    // 10. Overtrading days — days where you traded ≥ max(2× your median daily
    //     count, 4) AND finished net negative. Threshold is personalised.
    const dayCounts = [...byDay.values()].map(b => b.count).sort((a, b) => a - b);
    if (dayCounts.length >= 3) {
      const median = dayCounts[Math.floor(dayCounts.length / 2)];
      const threshold = Math.max(median * 2, 4);
      const overLosing = [...byDay.values()].filter(b => b.count >= threshold && b.pnl < 0);
      if (overLosing.length >= 1) {
        const total = overLosing.reduce((s, b) => s + b.pnl, 0);
        results.push({
          type: 'warning',
          text: `${overLosing.length} day${overLosing.length > 1 ? 's' : ''} with ≥${threshold} trades closed red (${fmtPnl(total, baseCurrency)} total) — overtrading signal vs your usual pace.`,
          why: `Overtrading is trading well above your normal pace — usually chasing action in a slow market or forcing trades to hit a P&L target. We flag days with at least ${threshold} trades because that's 2× your typical median day. The quality of setups tends to drop fast after the first few of the session.`,
          action: 'Set a daily max trade count based on your average (e.g. median + 2). Once you hit it, close the platform. Protect the edge by protecting your patience.',
        });
      }
    }

    // 11. Post-big-win giveback — after a top-quartile winner, later same-day
    //     trades net negative. Needs ≥4 winners to define a meaningful Q3.
    const winnerPnls = chrono.filter(t => pnlBase(t) > 0).map(t => pnlBase(t)).sort((a, b) => a - b);
    if (winnerPnls.length >= 4) {
      const q3 = winnerPnls[Math.floor(winnerPnls.length * 0.75)];
      let givebackCount = 0;
      for (let i = 0; i < chrono.length; i++) {
        const t = chrono[i];
        if (pnlBase(t) < q3) continue;
        const day = t.closed_at.slice(0, 10);
        let netAfter = 0;
        let laterCount = 0;
        for (let j = i + 1; j < chrono.length; j++) {
          const x = chrono[j];
          if (x.closed_at.slice(0, 10) !== day) break;
          netAfter += pnlBase(x);
          laterCount += 1;
        }
        if (laterCount >= 1 && netAfter < 0) givebackCount += 1;
      }
      if (givebackCount >= 2) {
        results.push({
          type: 'insight',
          text: `After ${givebackCount} of your biggest wins you gave back P&L on later trades that day. Consider stopping after a big green.`,
          why: 'After a big winner, two things happen: euphoria makes you feel unbeatable, and a comfortable day\'s P&L makes you willing to risk more loosely. Entries get sloppier, exits get wider, and the day slowly gives back what it earned.',
          action: 'Make it a rule: after a big green day or trade, stop. You already got paid. The next trade almost never matters as much as the win you just protected.',
        });
      }
    }

    // 12. Volatile daily P&L — one-day swings dwarf the average edge.
    if (byDay.size >= 5) {
      const dailyPnls = [...byDay.values()].map(b => b.pnl);
      const mean = dailyPnls.reduce((s, x) => s + x, 0) / dailyPnls.length;
      const variance = dailyPnls.reduce((s, x) => s + (x - mean) ** 2, 0) / dailyPnls.length;
      const stdDev = Math.sqrt(variance);
      if (Math.abs(mean) > 0 && stdDev > 2 * Math.abs(mean)) {
        const ratio = (stdDev / Math.abs(mean)).toFixed(1);
        results.push({
          type: 'insight',
          text: `Daily P&L is volatile — single-day swings are ~${ratio}× your average day. Smaller, steadier sizing compounds faster than boom/bust.`,
          why: 'High daily P&L volatility means one outlier day can wipe out several good ones. It usually traces back to inconsistent position sizing, concentrated bets on a single day, or trading bigger when confident and smaller when unsure (which amplifies both emotions).',
          action: 'Audit your sizing: are outsized days coming from more trades, bigger size per trade, or both? Standardising size per trade is the single biggest reducer of variance.',
        });
      }
    }

    return results;
  }, [trades, stats, symbolRows, adherenceStats, baseCurrency]);

  // ── chart domain ──
  const allCumVals = curveData.map(d => d.cumPnl);
  const yMin = Math.min(0, ...allCumVals);
  const yMax = Math.max(0, ...allCumVals);
  const yPad = Math.max((yMax - yMin) * 0.1, 50);

  if (loadError) {
    return (
      <div>
        <LoadError title="Could not load performance data" message={loadError} onRetry={() => setReloadKey(k => k + 1)} />
      </div>
    );
  }

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

      {/* ── period controls ── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-end gap-3">
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

      {/* ── auto callouts ──
          Each callout is a clickable card that expands to reveal "Why flagged"
          and "What to try" — turns the insight from a stat into a learning
          moment. Expand state is tracked per-index in a Set (multiple can be
          open at once). Cards without `why`/`action` fields silently skip the
          chevron, so older callout shapes still render cleanly. */}
      {callouts.length > 0 && (
        <div>
          <div className="flex items-baseline justify-between mb-3">
            <h3 className="text-sm font-semibold text-gray-700">Callouts</h3>
            <p className="text-xs text-gray-400">{callouts.length} signal{callouts.length !== 1 ? 's' : ''}</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-start">
          {callouts.map((c, i) => {
            // Editorial-card style: white bg, neutral body text, only the
            // 4px left accent bar + icon + section labels carry the color
            // cue. Keeps the page calm even when every callout happens to
            // be a warning.
            const accentStyles = {
              positive: 'border-l-green-500',
              warning:  'border-l-amber-500',
              insight:  'border-l-blue-500',
            };
            const labelStyles = {
              positive: 'text-green-700',
              warning:  'text-amber-700',
              insight:  'text-blue-700',
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
            const hasDetail = !!(c.why || c.action);
            const isOpen = expandedCallouts.has(i);
            return (
              <div key={i} className={`rounded-xl border border-gray-200 border-l-4 bg-white text-sm shadow-sm ${accentStyles[c.type]}`}>
                <button
                  type="button"
                  onClick={hasDetail ? () => toggleCallout(i) : undefined}
                  className={`w-full flex items-start gap-2.5 px-4 py-3 text-left ${hasDetail ? 'cursor-pointer hover:bg-gray-50' : 'cursor-default'} rounded-[inherit]`}
                  aria-expanded={hasDetail ? isOpen : undefined}
                >
                  {icons[c.type]}
                  <span className="flex-1 text-gray-900 font-medium">{c.text}</span>
                  {hasDetail && (
                    <svg
                      className={`w-4 h-4 shrink-0 mt-0.5 text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`}
                      fill="none" stroke="currentColor" viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  )}
                </button>
                {hasDetail && isOpen && (
                  <div className="px-4 pb-4 pt-1 border-t border-gray-100 space-y-3">
                    {c.why && (
                      <div>
                        <p className={`text-[11px] font-semibold uppercase tracking-wider mb-1 ${labelStyles[c.type]}`}>Why flagged</p>
                        <p className="text-sm leading-relaxed text-gray-700">{c.why}</p>
                      </div>
                    )}
                    {c.action && (
                      <div>
                        <p className={`text-[11px] font-semibold uppercase tracking-wider mb-1 ${labelStyles[c.type]}`}>What to try</p>
                        <p className="text-sm leading-relaxed text-gray-700">{c.action}</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          </div>
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
                  const returnState = { preset, customFrom, customTo };
                  return (
                  <tr
                    key={row.symbol}
                    onClick={() => navigate('/journal', { state: { symbolFilter: row.symbol, ...dateFilter, fromScreen: 'performance', returnState } })}
                    className="hover:bg-blue-50 cursor-pointer transition-colors"
                    title={`View ${row.symbol} trades in Smart Journal`}
                  >
                    <td className="px-3 sm:px-5 py-3.5 text-sm font-semibold text-blue-600 whitespace-nowrap">{fmtSymbol(row.symbol)}</td>
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

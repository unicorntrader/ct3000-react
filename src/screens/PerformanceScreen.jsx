import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../lib/supabaseClient';
import { pnlBase } from '../lib/formatters';
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

const currencySymbol = (c) => {
  switch (c) {
    case 'USD': return '$';
    case 'JPY': return '¥';
    case 'EUR': return '€';
    case 'GBP': return '£';
    default: return c ? c + ' ' : '$';
  }
};

const fmt$ = (n, currency = 'USD') => {
  if (n == null || isNaN(n)) return '—';
  const sym = currencySymbol(currency);
  const abs = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (n >= 0 ? '+' : '-') + sym + abs;
};

const fmtShort = (n, currency = 'USD') => {
  if (n == null || isNaN(n)) return '—';
  const sym = currencySymbol(currency);
  const abs = Math.abs(n);
  const sign = n >= 0 ? '+' : '-';
  if (abs >= 1000) return sign + sym + (abs / 1000).toFixed(1) + 'k';
  return sign + sym + abs.toFixed(0);
};

const fmtDay = (iso) => {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
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
        Day P&L: {fmt$(d.dayPnl, baseCurrency)}
      </p>
      <p className={`font-semibold ${(d.cumPnl || 0) >= 0 ? 'text-blue-600' : 'text-red-500'}`}>
        Cumulative: {fmt$(d.cumPnl, baseCurrency)}
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
        {fmt$(pnl, baseCurrency)}
      </span>
      <span className="text-xs text-gray-400 w-24 text-right shrink-0">
        {trades}tr · {wr}% WR
      </span>
    </div>
  );
}

// ─── main component ────────────────────────────────────────────────────────────

export default function PerformanceScreen({ session }) {
  const [allTrades, setAllTrades] = useState([]);
  const [baseCurrency, setBaseCurrency] = useState('USD');
  const [loading, setLoading] = useState(true);

  // period control
  const [preset, setPreset] = useState('All');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');

  // by-symbol sort
  const [sortCol, setSortCol] = useState('pnl');
  const [sortDir, setSortDir] = useState('desc');

  useEffect(() => {
    if (!session?.user?.id) return;
    const userId = session.user.id;
    Promise.all([
      supabase
        .from('logical_trades')
        .select('id, symbol, direction, asset_category, fx_rate_to_base, status, closed_at, opened_at, total_realized_pnl, matching_status')
        .eq('user_id', userId)
        .eq('status', 'closed'),
      supabase
        .from('user_ibkr_credentials')
        .select('base_currency')
        .eq('user_id', userId)
        .single(),
    ]).then(([tradesRes, credRes]) => {
      setAllTrades(tradesRes.data || []);
      if (credRes.data?.base_currency) setBaseCurrency(credRes.data.base_currency);
      setLoading(false);
    });
  }, [session]);

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

  // ── chart domain ──
  const allCumVals = curveData.map(d => d.cumPnl);
  const yMin = Math.min(0, ...allCumVals);
  const yMax = Math.max(0, ...allCumVals);
  const yPad = Math.max((yMax - yMin) * 0.1, 50);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-5 h-5 border-2 border-gray-200 border-t-blue-600 rounded-full animate-spin" />
      </div>
    );
  }

  const kpis = [
    {
      label: 'Net P&L',
      value: stats ? fmt$(stats.netPnl, baseCurrency) : '—',
      sub: stats ? `${stats.n} closed trades` : 'No data',
      color: stats ? (stats.netPnl >= 0 ? 'text-green-600' : 'text-red-500') : 'text-gray-400',
    },
    {
      label: 'Win rate',
      value: stats ? `${stats.winRate}%` : '—',
      sub: stats ? `${stats.winners}W · ${stats.losers}L` : 'No data',
      color: stats ? 'text-gray-900' : 'text-gray-400',
    },
    {
      label: 'Avg W / L',
      value: stats ? `${stats.wlRatio}` : '—',
      sub: stats ? `${fmt$(stats.avgWin, baseCurrency)} / ${fmt$(-stats.avgLoss, baseCurrency)}` : 'No data',
      color: stats ? 'text-gray-900' : 'text-gray-400',
    },
    {
      label: 'Expectancy',
      value: stats ? fmt$(stats.expectancy, baseCurrency) : '—',
      sub: 'per trade',
      color: stats ? (stats.expectancy >= 0 ? 'text-green-600' : 'text-red-500') : 'text-gray-400',
    },
  ];

  const SYM_COLS = [
    { key: 'symbol', label: 'Symbol' },
    { key: 'trades', label: 'Trades' },
    { key: 'winRate', label: 'Win rate' },
    { key: 'pnl', label: 'Net P&L' },
  ];

  return (
    <div className="space-y-6" style={{ fontFamily: "'DM Sans', sans-serif" }}>

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

      {/* ── 4 KPI cards ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {kpis.map(card => (
          <div key={card.label} className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
            <p className="text-xs font-medium text-gray-400 mb-1.5">{card.label}</p>
            <p className={`text-2xl font-semibold leading-none mb-1 ${card.color}`}>{card.value}</p>
            <p className="text-xs text-gray-400">{card.sub}</p>
          </div>
        ))}
      </div>

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
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                {SYM_COLS.map(col => (
                  <th
                    key={col.key}
                    onClick={() => handleSort(col.key)}
                    className="px-5 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer select-none hover:text-gray-700"
                  >
                    {col.label}
                    {sortIcon(sortCol === col.key, sortDir)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {symbolRows.map(row => (
                <tr key={row.symbol} className="hover:bg-gray-50">
                  <td className="px-5 py-3.5 text-sm font-semibold text-gray-900">{row.symbol}</td>
                  <td className="px-5 py-3.5 text-sm text-gray-600">{row.trades}</td>
                  <td className="px-5 py-3.5 text-sm text-gray-700">{row.winRate}%</td>
                  <td className={`px-5 py-3.5 text-sm font-semibold ${row.pnl >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                    {fmt$(row.pnl, baseCurrency)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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

    </div>
  );
}

import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../lib/supabaseClient';

const PERIODS = ['All', '3M', '1M', '1W'];

const periodStart = (p) => {
  if (p === 'All') return null;
  const d = new Date();
  if (p === '1W') d.setDate(d.getDate() - 7);
  if (p === '1M') d.setMonth(d.getMonth() - 1);
  if (p === '3M') d.setMonth(d.getMonth() - 3);
  return d.toISOString();
};

const fmtPnl = (n) => {
  if (n == null || isNaN(n)) return '—';
  const abs = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (n >= 0 ? '+$' : '-$') + abs;
};

export default function PerformanceScreen({ session }) {
  const [allTrades, setAllTrades] = useState([]);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState('All');
  const [perfTab, setPerfTab] = useState('overview');

  useEffect(() => {
    if (!session?.user?.id) return;
    fetchTrades();
  }, [session]);

  const fetchTrades = async () => {
    const { data } = await supabase
      .from('logical_trades')
      .select('total_realized_pnl, matching_status, status, closed_at, direction, asset_category, symbol')
      .eq('user_id', session.user.id)
      .eq('status', 'closed');

    setAllTrades(data || []);
    setLoading(false);
  };

  const trades = useMemo(() => {
    const start = periodStart(period);
    if (!start) return allTrades;
    return allTrades.filter(t => t.closed_at && t.closed_at >= start);
  }, [allTrades, period]);

  const stats = useMemo(() => {
    const closed = trades;
    const total = closed.length;
    if (total === 0) return null;

    const winners = closed.filter(t => (t.total_realized_pnl || 0) > 0);
    const losers  = closed.filter(t => (t.total_realized_pnl || 0) <= 0);

    const grossProfit = winners.reduce((s, t) => s + t.total_realized_pnl, 0);
    const grossLoss   = losers.reduce((s, t)  => s + t.total_realized_pnl, 0);
    const netPnl      = grossProfit + grossLoss;

    const avgWin  = winners.length > 0 ? grossProfit / winners.length : 0;
    const avgLoss = losers.length  > 0 ? Math.abs(grossLoss / losers.length) : 0;

    const profitFactor = grossLoss !== 0 ? Math.abs(grossProfit / grossLoss) : null;
    const expectancy   = netPnl / total;

    const matched   = closed.filter(t => t.matching_status === 'matched');
    const unmatched = closed.filter(t => t.matching_status === 'unmatched');
    const unplannedPnl = unmatched.reduce((s, t) => s + (t.total_realized_pnl || 0), 0);
    const matchRate = Math.round((matched.length / total) * 100);

    return {
      total, winners: winners.length, losers: losers.length,
      netPnl, grossProfit, grossLoss,
      avgWin, avgLoss, profitFactor, expectancy,
      matchRate, unplannedPnl,
    };
  }, [trades]);

  // Symbol breakdown for insights tab
  const symbolStats = useMemo(() => {
    const map = new Map();
    for (const t of trades) {
      if (!t.symbol) continue;
      if (!map.has(t.symbol)) map.set(t.symbol, { symbol: t.symbol, trades: 0, wins: 0, pnl: 0 });
      const s = map.get(t.symbol);
      s.trades++;
      s.pnl += t.total_realized_pnl || 0;
      if ((t.total_realized_pnl || 0) > 0) s.wins++;
    }
    return [...map.values()]
      .sort((a, b) => Math.abs(b.pnl) - Math.abs(a.pnl))
      .slice(0, 8);
  }, [trades]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-5 h-5 border-2 border-gray-200 border-t-blue-600 rounded-full animate-spin" />
      </div>
    );
  }

  const statCards = stats
    ? [
        { label: 'Net P&L', value: fmtPnl(stats.netPnl), sub: `${stats.total} closed trades`, color: stats.netPnl >= 0 ? 'text-green-600' : 'text-red-500' },
        { label: 'Win rate', value: `${Math.round((stats.winners / stats.total) * 100)}%`, sub: `${stats.winners}W · ${stats.losers}L`, color: 'text-gray-900' },
        { label: 'Profit factor', value: stats.profitFactor != null ? stats.profitFactor.toFixed(2) : '—', sub: `Avg win ${fmtPnl(stats.avgWin)}`, color: 'text-gray-900' },
        { label: 'Expectancy', value: fmtPnl(stats.expectancy), sub: 'per trade', color: stats.expectancy >= 0 ? 'text-green-600' : 'text-red-500' },
      ]
    : [
        { label: 'Net P&L', value: '—', sub: 'No data', color: 'text-gray-400' },
        { label: 'Win rate', value: '—', sub: 'No data', color: 'text-gray-400' },
        { label: 'Profit factor', value: '—', sub: 'No data', color: 'text-gray-400' },
        { label: 'Expectancy', value: '—', sub: 'No data', color: 'text-gray-400' },
      ];

  const breakdownRows = stats
    ? [
        { label: 'Gross profit',    value: fmtPnl(stats.grossProfit),  color: 'text-green-600' },
        { label: 'Gross loss',      value: fmtPnl(stats.grossLoss),    color: 'text-red-500' },
        { label: 'Avg winner',      value: fmtPnl(stats.avgWin),       color: 'text-green-600' },
        { label: 'Avg loser',       value: fmtPnl(-stats.avgLoss),     color: 'text-red-500' },
        { label: 'Plan match rate', value: `${stats.matchRate}%`,      color: 'text-blue-600' },
        { label: 'Unplanned P&L',  value: fmtPnl(stats.unplannedPnl), color: stats.unplannedPnl >= 0 ? 'text-green-600' : 'text-red-500' },
      ]
    : [];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-semibold text-gray-900">Performance</h2>
        <div className="flex space-x-2">
          {PERIODS.map(p => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`text-xs font-medium px-4 py-1.5 rounded-full whitespace-nowrap border transition-colors ${
                period === p
                  ? 'bg-blue-600 text-white border-transparent'
                  : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
              }`}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {statCards.map(card => (
          <div key={card.label} className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
            <p className="text-xs font-medium text-gray-400 mb-1">{card.label}</p>
            <p className={`text-2xl font-semibold ${card.color}`}>{card.value}</p>
            <p className="text-xs text-gray-400 mt-1">{card.sub}</p>
          </div>
        ))}
      </div>

      <div className="flex border-b border-gray-200 mb-6">
        {['overview', 'by symbol'].map(tab => (
          <button
            key={tab}
            onClick={() => setPerfTab(tab)}
            className={`text-sm font-medium px-5 py-3 border-b-2 transition-colors ${
              perfTab === tab
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>

      {perfTab === 'overview' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
            <h3 className="text-sm font-semibold text-gray-700 mb-4">Performance breakdown</h3>
            {!stats ? (
              <p className="text-sm text-gray-400 py-4 text-center">No closed trades in this period</p>
            ) : (
              <div className="space-y-0">
                {breakdownRows.map((row, i) => (
                  <div key={row.label} className={`flex justify-between py-3 ${i < breakdownRows.length - 1 ? 'border-b border-gray-50' : ''}`}>
                    <span className="text-sm text-gray-500">{row.label}</span>
                    <span className={`text-sm font-semibold ${row.color}`}>{row.value}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 flex items-center justify-center">
            <div className="text-center py-8">
              <svg className="w-10 h-10 text-gray-200 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
              <p className="text-sm text-gray-400">Equity curve -- coming soon</p>
            </div>
          </div>
        </div>
      )}

      {perfTab === 'by symbol' && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          {symbolStats.length === 0 ? (
            <div className="px-5 py-16 text-center">
              <p className="text-sm text-gray-400">No closed trades in this period</p>
            </div>
          ) : (
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  {['Symbol', 'Trades', 'Win rate', 'Net P&L'].map(h => (
                    <th key={h} className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {symbolStats.map(s => {
                  const wr = Math.round((s.wins / s.trades) * 100);
                  return (
                    <tr key={s.symbol} className="hover:bg-gray-50">
                      <td className="px-6 py-4 text-sm font-semibold text-gray-900">{s.symbol}</td>
                      <td className="px-6 py-4 text-sm text-gray-600">{s.trades}</td>
                      <td className="px-6 py-4 text-sm text-gray-700">{wr}%</td>
                      <td className={`px-6 py-4 text-sm font-semibold ${s.pnl >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                        {fmtPnl(s.pnl)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

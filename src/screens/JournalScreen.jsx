import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../lib/supabaseClient';

const FILTERS = ['All', 'Wins', 'Losses', 'Matched', 'Unmatched', 'Ambiguous'];

const planStyles = {
  matched: 'bg-blue-50 text-blue-600',
  unmatched: 'bg-amber-50 text-amber-600',
  ambiguous: 'bg-purple-50 text-purple-600',
  auto: 'bg-gray-100 text-gray-500',
  manual: 'bg-green-50 text-green-700',
};

const fmtPnl = (n) => {
  if (n == null) return '—';
  const abs = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (n >= 0 ? '+$' : '-$') + abs;
};

const fmtDate = (iso) => {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

const calcR = (trade, plan) => {
  if (!plan) return null;
  const entry = plan.entry_price ?? plan.entry;
  const stop = plan.stop_price ?? plan.stop;
  const qty = trade.total_closing_quantity || trade.total_opening_quantity;
  if (entry == null || stop == null || !qty) return null;
  const riskPerShare = Math.abs(entry - stop);
  if (riskPerShare === 0) return null;
  const r = trade.total_realized_pnl / (riskPerShare * qty);
  return r.toFixed(1) + 'R';
};

export default function JournalScreen({ session }) {
  const [trades, setTrades] = useState([]);
  const [plansMap, setPlansMap] = useState({});
  const [loading, setLoading] = useState(true);
  const [activeFilter, setActiveFilter] = useState('All');

  useEffect(() => {
    if (!session?.user?.id) return;
    fetchData();
  }, [session]);

  const fetchData = async () => {
    const userId = session.user.id;
    const [tradesRes, plansRes] = await Promise.all([
      supabase
        .from('logical_trades')
        .select('*')
        .eq('user_id', userId)
        .eq('status', 'closed')
        .order('closed_at', { ascending: false }),
      supabase
        .from('planned_trades')
        .select('id, entry_price, entry, stop_price, stop, symbol, direction')
        .eq('user_id', userId),
    ]);

    const map = {};
    for (const p of (plansRes.data || [])) map[p.id] = p;
    setPlansMap(map);
    setTrades(tradesRes.data || []);
    setLoading(false);
  };

  const filtered = useMemo(() => {
    switch (activeFilter) {
      case 'Wins':      return trades.filter(t => (t.total_realized_pnl || 0) > 0);
      case 'Losses':    return trades.filter(t => (t.total_realized_pnl || 0) <= 0);
      case 'Matched':   return trades.filter(t => t.matching_status === 'matched');
      case 'Unmatched': return trades.filter(t => t.matching_status === 'unmatched');
      case 'Ambiguous': return trades.filter(t => t.matching_status === 'ambiguous');
      default:          return trades;
    }
  }, [trades, activeFilter]);

  const wins = trades.filter(t => (t.total_realized_pnl || 0) > 0).length;
  const winRate = trades.length > 0 ? Math.round((wins / trades.length) * 100) : null;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-5 h-5 border-2 border-gray-200 border-t-blue-600 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-semibold text-gray-900">Smart Journal</h2>
      </div>

      <div className="grid grid-cols-3 gap-4 mb-6">
        {[
          { label: 'Trades', value: trades.length > 0 ? String(trades.length) : '—', color: 'text-gray-900' },
          { label: 'Win rate', value: winRate != null ? `${winRate}%` : '—', color: 'text-green-600' },
          { label: 'Matched', value: trades.length > 0 ? `${Math.round((trades.filter(t => t.matching_status === 'matched').length / trades.length) * 100)}%` : '—', color: 'text-blue-600' },
        ].map(c => (
          <div key={c.label} className="bg-white rounded-xl p-4 text-center shadow-sm border border-gray-100">
            <p className="text-xs text-gray-400 mb-1">{c.label}</p>
            <p className={`text-2xl font-semibold ${c.color}`}>{c.value}</p>
          </div>
        ))}
      </div>

      <div className="flex space-x-2 mb-5 overflow-x-auto pb-1">
        {FILTERS.map(f => (
          <button
            key={f}
            onClick={() => setActiveFilter(f)}
            className={`text-xs font-medium px-4 py-1.5 rounded-full whitespace-nowrap border transition-colors ${
              activeFilter === f
                ? 'bg-blue-600 text-white border-transparent'
                : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 px-5 py-16 text-center">
          <p className="text-sm font-medium text-gray-500 mb-1">
            {trades.length === 0 ? 'No closed trades yet' : 'No trades match this filter'}
          </p>
          <p className="text-xs text-gray-400">
            {trades.length === 0 ? 'Sync your IBKR account to import trades' : 'Try a different filter'}
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                {['Date', 'Symbol', 'Direction', 'P&L', 'R', 'Outcome', 'Plan'].map(h => (
                  <th key={h} className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map((trade) => {
                const pnl = trade.total_realized_pnl || 0;
                const isWin = pnl > 0;
                const plan = plansMap[trade.planned_trade_id];
                const rMultiple = calcR(trade, plan);
                const matchStatus = trade.matching_status || 'auto';

                return (
                  <tr key={trade.id} className="hover:bg-gray-50 cursor-pointer">
                    <td className="px-6 py-4 text-sm text-gray-600">{fmtDate(trade.closed_at)}</td>
                    <td className="px-6 py-4 text-sm font-semibold text-gray-900">{trade.symbol}</td>
                    <td className="px-6 py-4 text-sm text-gray-600">{trade.direction}</td>
                    <td className={`px-6 py-4 text-sm font-semibold ${isWin ? 'text-green-600' : 'text-red-500'}`}>
                      {fmtPnl(pnl)}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-600">{rMultiple ?? '—'}</td>
                    <td className="px-6 py-4">
                      <span className={`px-2.5 py-1 text-xs rounded-full font-medium ${
                        isWin ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-700'
                      }`}>
                        {isWin ? 'win' : 'loss'}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`px-2 py-0.5 text-xs rounded-full font-medium ${planStyles[matchStatus] || 'bg-gray-100 text-gray-500'}`}>
                        {matchStatus.charAt(0).toUpperCase() + matchStatus.slice(1)}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

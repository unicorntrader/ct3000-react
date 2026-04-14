import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../lib/supabaseClient';
import { fmtPnl, fmtDate, pnlBase } from '../lib/formatters';
import PrivacyValue from '../components/PrivacyValue';
import ShareModal from '../components/ShareModal';
import TradeJournalDrawer from '../components/TradeJournalDrawer';

const FILTERS = ['All', 'Open', 'Wins', 'Losses', 'Matched', 'Unmatched', 'Ambiguous', 'Journalled', 'Not journalled'];

const planStyles = {
  matched: 'bg-blue-50 text-blue-600',
  unmatched: 'bg-amber-50 text-amber-600',
  ambiguous: 'bg-purple-50 text-purple-600',
  auto: 'bg-gray-100 text-gray-500',
  manual: 'bg-green-50 text-green-700',
};

const calcR = (trade, plan) => {
  if (!plan) return null;
  const { planned_entry_price: entry, planned_stop_loss: stop } = plan;
  const qty = trade.total_closing_quantity || trade.total_opening_quantity;
  if (entry == null || stop == null || !qty) return null;
  const riskPerShare = Math.abs(entry - stop);
  if (riskPerShare === 0) return null;
  const r = pnlBase(trade) / (riskPerShare * qty);
  return r.toFixed(1) + 'R';
};

export default function JournalScreen({ session }) {
  const userId = session?.user?.id;
  const [trades, setTrades] = useState([]);
  const [plansMap, setPlansMap] = useState({});
  const [baseCurrency, setBaseCurrency] = useState('USD');
  const [loading, setLoading] = useState(true);
  const [activeFilter, setActiveFilter] = useState('All');
  const [shareRow, setShareRow] = useState(null);
  const [drawerTrade, setDrawerTrade] = useState(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    if (!userId) return;
    const load = async () => {
      const [tradesRes, plansRes, credsRes] = await Promise.all([
        supabase
          .from('logical_trades')
          .select('*')
          .eq('user_id', userId)
          .order('opened_at', { ascending: false }),
        supabase
          .from('planned_trades')
          .select('id, symbol, direction, planned_entry_price, planned_stop_loss, planned_target_price, planned_quantity, notes, thesis')
          .eq('user_id', userId),
        supabase
          .from('user_ibkr_credentials')
          .select('base_currency')
          .eq('user_id', userId)
          .maybeSingle(),
      ]);
      const map = {};
      for (const p of (plansRes.data || [])) map[p.id] = p;
      setPlansMap(map);
      setTrades(tradesRes.data || []);
      if (credsRes.data?.base_currency) setBaseCurrency(credsRes.data.base_currency);
      setLoading(false);
    };
    load();
  }, [userId]);

  const handleTradeUpdated = (updatedTrade) => {
    setTrades(prev => prev.map(t => t.id === updatedTrade.id ? updatedTrade : t));
  };

  const filtered = useMemo(() => {
    switch (activeFilter) {
      case 'Open':      return trades.filter(t => t.status === 'open');
      case 'Wins':      return trades.filter(t => t.status === 'closed' && (t.total_realized_pnl || 0) > 0);
      case 'Losses':    return trades.filter(t => t.status === 'closed' && (t.total_realized_pnl || 0) <= 0);
      case 'Matched':   return trades.filter(t => t.matching_status === 'matched');
      case 'Unmatched': return trades.filter(t => t.matching_status === 'unmatched');
      case 'Ambiguous':       return trades.filter(t => t.matching_status === 'ambiguous');
      case 'Journalled':      return trades.filter(t => t.review_notes);
      case 'Not journalled':  return trades.filter(t => t.status === 'closed' && !t.review_notes);
      default:                return trades;
    }
  }, [trades, activeFilter]);

  const closedTrades = trades.filter(t => t.status === 'closed');
  const wins = closedTrades.filter(t => (t.total_realized_pnl || 0) > 0).length;
  const winRate = closedTrades.length > 0 ? Math.round((wins / closedTrades.length) * 100) : null;

  if (loading) {
    return (
      <div className="animate-pulse">
        <div className="flex items-center justify-between mb-6">
          <div className="h-7 bg-gray-200 rounded w-32" />
        </div>
        <div className="grid grid-cols-3 gap-4 mb-6">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="bg-white rounded-xl p-4 text-center shadow-sm border border-gray-100">
              <div className="h-3 bg-gray-200 rounded w-20 mx-auto mb-3" />
              <div className="h-7 bg-gray-200 rounded w-12 mx-auto" />
            </div>
          ))}
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="flex items-center space-x-4 px-5 py-4 border-b border-gray-50 last:border-0">
              <div className="h-4 bg-gray-200 rounded w-20" />
              <div className="h-4 bg-gray-200 rounded w-16" />
              <div className="h-4 bg-gray-200 rounded w-12" />
              <div className="h-4 bg-gray-200 rounded w-16 ml-auto" />
            </div>
          ))}
        </div>
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
          { label: 'Closed trades', value: closedTrades.length > 0 ? String(closedTrades.length) : '—', color: 'text-gray-900' },
          { label: 'Win rate', value: winRate != null ? `${winRate}%` : '—', color: 'text-green-600' },
          { label: 'Journalled', value: closedTrades.length > 0 ? `${closedTrades.filter(t => t.review_notes).length} / ${closedTrades.length}` : '—', color: 'text-blue-600' },
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
            {trades.length === 0 ? 'No trades yet' : 'No trades match this filter'}
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
                {['Date', 'Symbol', 'Direction', 'P&L', 'R', 'Outcome', 'Plan', 'Journal', ''].map(h => (
                  <th key={h} className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map((trade) => {
                const isOpen = trade.status === 'open';
                const pnl = isOpen ? null : pnlBase(trade);
                const isWin = (pnl || 0) > 0;
                const plan = plansMap[trade.planned_trade_id];
                const rMultiple = isOpen ? null : calcR(trade, plan);
                const matchStatus = trade.matching_status || 'auto';
                const dateDisplay = fmtDate(isOpen ? trade.opened_at : trade.closed_at);

                return (
                  <tr key={trade.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => { setDrawerTrade(trade); setDrawerOpen(true) }}>
                    <td className="px-6 py-4 text-sm text-gray-600">{dateDisplay}</td>
                    <td className="px-6 py-4 text-sm font-semibold text-gray-900">{trade.symbol}</td>
                    <td className="px-6 py-4 text-sm text-gray-600">{trade.direction}</td>
                    <td className={`px-6 py-4 text-sm font-semibold ${isOpen ? 'text-gray-400' : isWin ? 'text-green-600' : 'text-red-500'}`}>
                      {isOpen ? '—' : <PrivacyValue value={fmtPnl(pnl, baseCurrency)} />}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-600">{rMultiple ?? '—'}</td>
                    <td className="px-6 py-4">
                      {isOpen ? (
                        <span className="px-2.5 py-1 text-xs rounded-full font-medium bg-blue-50 text-blue-600">open</span>
                      ) : (
                        <span className={`px-2.5 py-1 text-xs rounded-full font-medium ${
                          isWin ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-700'
                        }`}>
                          {isWin ? 'win' : 'loss'}
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <span className={`px-2 py-0.5 text-xs rounded-full font-medium ${planStyles[matchStatus] || 'bg-gray-100 text-gray-500'}`}>
                        {matchStatus.charAt(0).toUpperCase() + matchStatus.slice(1)}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      {isOpen ? null : trade.review_notes ? (
                        <span className="inline-flex items-center gap-1.5 text-xs text-green-600 font-medium">
                          <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" />
                          Journalled
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 text-xs text-gray-400">
                          <span className="w-1.5 h-1.5 rounded-full bg-gray-300 inline-block" />
                          Add notes
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-4">
                      {!isOpen && (
                        <button
                          onClick={e => { e.stopPropagation(); setShareRow(trade); }}
                          className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                          title="Share on X"
                        >
                          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.74l7.73-8.835L1.254 2.25H8.08l4.259 5.632 5.905-5.632zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                          </svg>
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <TradeJournalDrawer
        trade={drawerTrade}
        plan={plansMap[drawerTrade?.planned_trade_id]}
        baseCurrency={baseCurrency}
        isOpen={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        onSaved={handleTradeUpdated}
      />

      {shareRow && (() => {
        const plan = plansMap[shareRow.planned_trade_id];
        return (
          <ShareModal
            row={{
              symbol: shareRow.symbol,
              direction: shareRow.direction,
              nativePnl: shareRow.total_realized_pnl,
              currency: shareRow.currency,
              entry: shareRow.avg_entry_price,
              qty: shareRow.total_opening_quantity,
              closingQty: shareRow.total_closing_quantity,
              assetCategory: shareRow.asset_category,
              plannedTradeId: shareRow.planned_trade_id,
            }}
            plannedStop={plan?.planned_stop_loss ?? null}
            baseCurrency={baseCurrency}
            onClose={() => setShareRow(null)}
          />
        );
      })()}
    </div>
  );
}

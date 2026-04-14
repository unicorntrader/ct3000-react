import React, { useState, useEffect, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabaseClient';
import { fmtPnl, fmtDate, pnlBase } from '../lib/formatters';
import PrivacyValue from '../components/PrivacyValue';
import ShareModal from '../components/ShareModal';
import TradeJournalDrawer from '../components/TradeJournalDrawer';

const FILTERS = ['All', 'Open', 'Wins', 'Losses', 'Matched', 'Unmatched', 'Ambiguous', 'Journalled', 'Not journalled'];

const DATE_RANGES = [
  { key: 'all', label: 'All time' },
  { key: '1w', label: 'Last week' },
  { key: '1m', label: 'Last month' },
  { key: '3m', label: 'Last 3M' },
  { key: 'custom', label: 'Custom' },
];

const rangeStartDate = (key) => {
  if (key === 'all' || key === 'custom') return null;
  const d = new Date();
  if (key === '1w') d.setDate(d.getDate() - 7);
  else if (key === '1m') d.setMonth(d.getMonth() - 1);
  else if (key === '3m') d.setMonth(d.getMonth() - 3);
  return d.toISOString().slice(0, 10);
};

// OPT symbols from IBKR look like "NVDA 260330P00170000" — display only the underlying
const displaySymbol = (t) =>
  t.asset_category === 'OPT' ? (t.symbol || '').split(' ')[0] : (t.symbol || '');

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
  const location = useLocation();
  const navigate = useNavigate();
  const initialSymbol = location.state?.symbolFilter || '';
  const initialDateRange = location.state?.dateRange || 'all';
  const initialCustomFrom = location.state?.customFrom || '';
  const initialCustomTo = location.state?.customTo || '';
  const [trades, setTrades] = useState([]);
  const [plansMap, setPlansMap] = useState({});
  const [baseCurrency, setBaseCurrency] = useState('USD');
  const [loading, setLoading] = useState(true);
  const [activeFilter, setActiveFilter] = useState('All');
  const [shareRow, setShareRow] = useState(null);
  const [drawerTrade, setDrawerTrade] = useState(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Smart filters
  const [symbolQuery, setSymbolQuery] = useState(initialSymbol);
  const [symbolSuggestOpen, setSymbolSuggestOpen] = useState(false);
  const [directionFilter, setDirectionFilter] = useState('All');
  const [assetFilter, setAssetFilter] = useState('All');
  const [dateRange, setDateRange] = useState(initialDateRange);
  const [customFrom, setCustomFrom] = useState(initialCustomFrom);
  const [customTo, setCustomTo] = useState(initialCustomTo);

  // Clear navigation state after consuming so reloads don't re-apply
  useEffect(() => {
    if (location.state?.symbolFilter || location.state?.dateRange) {
      navigate(location.pathname, { replace: true, state: {} });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
          .select('id, symbol, direction, planned_entry_price, planned_stop_loss, planned_target_price, planned_quantity, thesis')
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

  // Derived lists for filter UI
  const allSymbols = useMemo(() => {
    const set = new Set();
    for (const t of trades) {
      const s = displaySymbol(t);
      if (s) set.add(s);
    }
    return [...set].sort();
  }, [trades]);

  const allAssetCategories = useMemo(() => {
    const set = new Set();
    for (const t of trades) if (t.asset_category) set.add(t.asset_category);
    return [...set].sort();
  }, [trades]);

  const symbolSuggestions = useMemo(() => {
    const q = symbolQuery.trim().toUpperCase();
    if (!q) return [];
    return allSymbols.filter(s => s.toUpperCase().includes(q)).slice(0, 8);
  }, [symbolQuery, allSymbols]);

  const filtered = useMemo(() => {
    // Stage 1: tab filter (status/outcome/matching/journal)
    let list;
    switch (activeFilter) {
      case 'Open':      list = trades.filter(t => t.status === 'open'); break;
      case 'Wins':      list = trades.filter(t => t.status === 'closed' && (t.total_realized_pnl || 0) > 0); break;
      case 'Losses':    list = trades.filter(t => t.status === 'closed' && (t.total_realized_pnl || 0) <= 0); break;
      case 'Matched':   list = trades.filter(t => t.matching_status === 'matched'); break;
      case 'Unmatched': list = trades.filter(t => t.matching_status === 'unmatched'); break;
      case 'Ambiguous':      list = trades.filter(t => t.matching_status === 'ambiguous'); break;
      case 'Journalled':     list = trades.filter(t => t.review_notes); break;
      case 'Not journalled': list = trades.filter(t => t.status === 'closed' && !t.review_notes); break;
      default:               list = trades;
    }

    // Stage 2: smart filters (AND logic)
    const symQ = symbolQuery.trim().toUpperCase();
    const startDate = dateRange === 'custom' ? (customFrom || null) : rangeStartDate(dateRange);
    const endDate = dateRange === 'custom' ? (customTo || null) : null;

    return list.filter(t => {
      if (symQ) {
        const s = displaySymbol(t).toUpperCase();
        if (!s.includes(symQ)) return false;
      }
      if (directionFilter !== 'All' && t.direction !== directionFilter) return false;
      if (assetFilter !== 'All' && t.asset_category !== assetFilter) return false;
      if (startDate || endDate) {
        const iso = t.status === 'open' ? t.opened_at : (t.closed_at || t.opened_at);
        if (!iso) return false;
        const day = iso.slice(0, 10);
        if (startDate && day < startDate) return false;
        if (endDate && day > endDate) return false;
      }
      return true;
    });
  }, [trades, activeFilter, symbolQuery, directionFilter, assetFilter, dateRange, customFrom, customTo]);

  const hasSmartFilters = symbolQuery || directionFilter !== 'All' || assetFilter !== 'All' || dateRange !== 'all';
  const clearSmartFilters = () => {
    setSymbolQuery('');
    setDirectionFilter('All');
    setAssetFilter('All');
    setDateRange('all');
    setCustomFrom('');
    setCustomTo('');
  };

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

      {/* Smart filter bar */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 mb-4">
        <div className="flex flex-wrap items-end gap-3">
          {/* Symbol autocomplete */}
          <div className="relative">
            <label className="block text-xs font-medium text-gray-400 mb-1">Symbol</label>
            <input
              type="text"
              value={symbolQuery}
              onChange={e => { setSymbolQuery(e.target.value); setSymbolSuggestOpen(true); }}
              onFocus={() => setSymbolSuggestOpen(true)}
              onBlur={() => setTimeout(() => setSymbolSuggestOpen(false), 150)}
              placeholder="Any"
              className="w-36 text-sm px-3 py-1.5 rounded-lg border border-gray-200 bg-white focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
            {symbolSuggestOpen && symbolSuggestions.length > 0 && (
              <div className="absolute z-20 mt-1 w-36 bg-white rounded-lg shadow-lg border border-gray-100 max-h-48 overflow-y-auto">
                {symbolSuggestions.map(s => (
                  <button
                    key={s}
                    type="button"
                    onMouseDown={(e) => { e.preventDefault(); setSymbolQuery(s); setSymbolSuggestOpen(false); }}
                    className="block w-full text-left text-sm px-3 py-1.5 hover:bg-gray-50"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Direction */}
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">Direction</label>
            <select
              value={directionFilter}
              onChange={e => setDirectionFilter(e.target.value)}
              className="text-sm px-3 py-1.5 rounded-lg border border-gray-200 bg-white focus:outline-none focus:ring-2 focus:ring-blue-400"
            >
              <option value="All">All</option>
              <option value="LONG">Long</option>
              <option value="SHORT">Short</option>
            </select>
          </div>

          {/* Asset class */}
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">Asset class</label>
            <select
              value={assetFilter}
              onChange={e => setAssetFilter(e.target.value)}
              className="text-sm px-3 py-1.5 rounded-lg border border-gray-200 bg-white focus:outline-none focus:ring-2 focus:ring-blue-400"
            >
              <option value="All">All</option>
              {allAssetCategories.map(a => (
                <option key={a} value={a}>{a}</option>
              ))}
            </select>
          </div>

          {/* Date range */}
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">Date range</label>
            <select
              value={dateRange}
              onChange={e => setDateRange(e.target.value)}
              className="text-sm px-3 py-1.5 rounded-lg border border-gray-200 bg-white focus:outline-none focus:ring-2 focus:ring-blue-400"
            >
              {DATE_RANGES.map(r => (
                <option key={r.key} value={r.key}>{r.label}</option>
              ))}
            </select>
          </div>

          {dateRange === 'custom' && (
            <>
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">From</label>
                <input
                  type="date"
                  value={customFrom}
                  onChange={e => setCustomFrom(e.target.value)}
                  className="text-sm px-3 py-1.5 rounded-lg border border-gray-200 bg-white focus:outline-none focus:ring-2 focus:ring-blue-400"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">To</label>
                <input
                  type="date"
                  value={customTo}
                  onChange={e => setCustomTo(e.target.value)}
                  className="text-sm px-3 py-1.5 rounded-lg border border-gray-200 bg-white focus:outline-none focus:ring-2 focus:ring-blue-400"
                />
              </div>
            </>
          )}

          {hasSmartFilters && (
            <button
              type="button"
              onClick={clearSmartFilters}
              className="text-xs font-medium text-gray-500 hover:text-gray-800 px-3 py-1.5 rounded-lg hover:bg-gray-50"
            >
              Clear
            </button>
          )}
        </div>
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
                    <td className="px-6 py-4 max-w-[16rem]">
                      {isOpen ? null : trade.review_notes ? (
                        <span
                          className="block text-xs text-gray-600 italic truncate"
                          title={trade.review_notes}
                        >
                          “{trade.review_notes}”
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

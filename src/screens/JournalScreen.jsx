import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabaseClient';
import { fmtPnl, fmtDate, fmtSymbol } from '../lib/formatters';
import { useBaseCurrency } from '../lib/BaseCurrencyContext';
import { computeAdherenceScore } from '../lib/adherenceScore';
import PrivacyValue from '../components/PrivacyValue';
import ShareModal from '../components/ShareModal';
import TradeInlineDetail from '../components/TradeInlineDetail';
import PlaybookSheet from '../components/PlaybookSheet';

// Smart Journal sections. Each is a different reflection surface:
//   taken     — review closed trades (plan adherence, notes, wins/losses)
//   missed    — log / reflect on setups you saw but did not take (coming soon)
//   playbooks — define and manage reusable setup patterns
const SECTIONS = [
  { key: 'taken',     label: 'Taken' },
  { key: 'missed',    label: 'Missed' },
  { key: 'playbooks', label: 'Playbooks' },
];

// Adherence pill — same color thresholds as the drawer.
// Both branches use identical padding so the row height doesn't jitter
// when filters switch the mix of trades with/without a score.
function AdherencePill({ score }) {
  if (score == null) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 text-xs text-gray-300">—</span>
    );
  }
  const rounded = Math.round(score);
  const { bg, text } = rounded >= 75
    ? { bg: 'bg-green-100', text: 'text-green-700' }
    : rounded >= 50
    ? { bg: 'bg-amber-100', text: 'text-amber-700' }
    : { bg: 'bg-red-100', text: 'text-red-700' };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${bg} ${text}`}>
      {rounded}
    </span>
  );
}

// Filter semantics — Smart Journal is for REVIEWING closed trades. Open
// positions belong on HomeScreen / DailyView, not here. Every tab in this
// bar is implicitly scoped to status = 'closed'.
//   All            — default view, all closed trades
//   Wins / Losses  — by P&L sign
//   Need matching  — matching_status = 'needs_review' (2+ candidate plans)
//   Planned        — matching_status = 'matched'
//   Off-plan       — matching_status = 'off_plan'
//   Not journalled — no review_notes
//   Fully done     — resolved (matched or off_plan) AND has review_notes.
//                    Matches the "Fully done" card on HomeScreen pipeline.
const FILTERS = ['All', 'Wins', 'Losses', 'Need matching', 'Planned', 'Off-plan', 'Not journalled', 'Fully done'];

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

// Plan pill: 1:1 with matching_status now that vocabulary is 3-state.
function planPillFor(trade) {
  const s = trade.matching_status;
  if (s === 'matched')      return { label: 'Planned',       cls: 'bg-blue-50 text-blue-600' };
  if (s === 'off_plan')     return { label: 'Off-plan',      cls: 'bg-gray-100 text-gray-600' };
  // needs_review, and any unknown/legacy value as a safety default
  return { label: 'Need matching', cls: 'bg-amber-50 text-amber-700' };
}

const calcR = (trade, plan) => {
  if (!plan) return null;
  const { planned_entry_price: entry, planned_stop_loss: stop } = plan;
  const qty = trade.total_closing_quantity || trade.total_opening_quantity;
  if (entry == null || stop == null || !qty) return null;
  const riskPerShare = Math.abs(entry - stop);
  if (riskPerShare === 0) return null;
  // R-multiple is unitless — use native P&L so numerator and denominator share units.
  // Using pnlBase() here would silently scale R by fx_rate_to_base for non-base trades.
  const r = (trade.total_realized_pnl || 0) / (riskPerShare * qty);
  return r.toFixed(1) + 'R';
};

export default function JournalScreen({ session }) {
  const userId = session?.user?.id;
  const location = useLocation();
  const navigate = useNavigate();
  const baseCurrency = useBaseCurrency();
  const [trades, setTrades] = useState([]);
  const [plansMap, setPlansMap] = useState({});
  const [loading, setLoading] = useState(true);
  const [activeFilter, setActiveFilter] = useState('All');

  // Top-level section (Taken / Missed / Playbooks). Initialized from
  // location.state so HomeScreen can deep-link (e.g. pipeline card → Missed).
  const [activeSection, setActiveSection] = useState(() => location.state?.activeSection || 'taken');

  // Playbooks section state
  const [playbooks, setPlaybooks] = useState([]);
  const [playbooksLoading, setPlaybooksLoading] = useState(false);
  const [playbookSheetOpen, setPlaybookSheetOpen] = useState(false);
  const [editingPlaybook, setEditingPlaybook] = useState(null);
  const [shareRow, setShareRow] = useState(null);
  // Inline-expansion: one row open at a time. Click to toggle.
  const [expandedTradeId, setExpandedTradeId] = useState(null);
  // Bulk selection — only applies to needs_review trades.
  // Stored as a Set of trade IDs for O(1) toggle/check.
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [bulkSaving, setBulkSaving] = useState(false);

  // Smart filters
  const [symbolQuery, setSymbolQuery] = useState('');
  const [symbolSuggestOpen, setSymbolSuggestOpen] = useState(false);
  const [directionFilter, setDirectionFilter] = useState('All');
  const [assetFilter, setAssetFilter] = useState('All');
  const [dateRange, setDateRange] = useState('all');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');

  // Apply navigation state (from Performance → Journal symbol click) whenever it
  // changes, not just once at mount. This handles the case where the user comes
  // back to Journal a second time with a different symbol while the component
  // stays mounted. After applying, clear state so a page reload doesn't re-apply.
  useEffect(() => {
    const s = location.state;
    if (!s) return;
    const hasFilter = s.symbolFilter || s.dateRange || s.customFrom || s.customTo || s.activeFilter || s.activeSection;
    if (!hasFilter) return;
    if (s.symbolFilter != null) setSymbolQuery(s.symbolFilter);
    if (s.dateRange != null) setDateRange(s.dateRange);
    if (s.customFrom != null) setCustomFrom(s.customFrom);
    if (s.customTo != null) setCustomTo(s.customTo);
    if (s.activeFilter != null) setActiveFilter(s.activeFilter);
    if (s.activeSection != null) setActiveSection(s.activeSection);
    navigate(location.pathname, { replace: true, state: {} });
  }, [location.state, location.pathname, navigate]);

  // Load playbooks when the section is opened (cached across toggles)
  const loadPlaybooks = useCallback(async () => {
    if (!userId) return;
    setPlaybooksLoading(true);
    const { data, error } = await supabase
      .from('playbooks')
      .select('id, name, description, created_at, updated_at')
      .eq('user_id', userId)
      .order('updated_at', { ascending: false });
    if (error) {
      console.error('[journal] load playbooks failed:', error.message);
    }
    setPlaybooks(data || []);
    setPlaybooksLoading(false);
  }, [userId]);

  useEffect(() => {
    if (activeSection === 'playbooks') loadPlaybooks();
  }, [activeSection, loadPlaybooks]);

  // Server-side date scoping — push the date range into the Supabase query
  // so we don't fetch the user's entire trade history on every load.
  // Symbol / direction / asset filters stay client-side (symbol autocomplete
  // needs the full result set within the date window).
  useEffect(() => {
    if (!userId) return;
    setLoading(true);

    // Compute the date boundary from the current dateRange state
    const startDate = dateRange === 'custom' ? (customFrom || null) : rangeStartDate(dateRange);
    const endDate = dateRange === 'custom' ? (customTo || null) : null;

    let query = supabase
      .from('logical_trades')
      .select('*')
      .eq('user_id', userId)
      .eq('status', 'closed')
      .order('closed_at', { ascending: false });

    if (startDate) query = query.gte('closed_at', startDate);
    if (endDate) query = query.lte('closed_at', endDate + 'T23:59:59');

    const load = async () => {
      const [tradesRes, plansRes] = await Promise.all([
        query,
        supabase
          .from('planned_trades')
          .select('id, symbol, direction, planned_entry_price, planned_stop_loss, planned_target_price, planned_quantity, thesis, currency')
          .eq('user_id', userId),
      ]);
      const map = {};
      for (const p of (plansRes.data || [])) map[p.id] = p;
      setPlansMap(map);
      setTrades(tradesRes.data || []);
      setLoading(false);
    };
    load();
  }, [userId, dateRange, customFrom, customTo]);

  const handleTradeUpdated = (updatedTrade) => {
    setTrades(prev => prev.map(t => t.id === updatedTrade.id ? updatedTrade : t));
  };

  // ── Bulk selection helpers ──
  const toggleSelect = (id) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const clearSelection = () => setSelectedIds(new Set());

  // Bulk "Mark off-plan": applies to all selected needs_review trades.
  // Sets matching_status='off_plan' + user_reviewed=true so the decision
  // survives subsequent rebuilds.
  const handleBulkMarkOffPlan = async () => {
    if (selectedIds.size === 0 || bulkSaving) return;
    const ids = [...selectedIds];
    const ok = window.confirm(
      `Mark ${ids.length} trade${ids.length !== 1 ? 's' : ''} as off-plan? They'll move out of Needs review.`
    );
    if (!ok) return;
    setBulkSaving(true);
    const { data: updatedRows, error } = await supabase
      .from('logical_trades')
      .update({ matching_status: 'off_plan', planned_trade_id: null, user_reviewed: true })
      .in('id', ids)
      .eq('user_id', userId)
      .select();
    setBulkSaving(false);
    if (error) {
      console.error('[journal] bulk off-plan failed:', error.message);
      alert(`Could not mark trades off-plan: ${error.message}`);
      return;
    }
    // Optimistically patch the local trade list with the updated rows
    if (updatedRows?.length) {
      const byId = new Map(updatedRows.map(r => [r.id, r]));
      setTrades(prev => prev.map(t => byId.get(t.id) || t));
    }
    clearSelection();
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
    // Date filtering is now server-side (pushed into the Supabase query).
    // The query also already filters to status='closed'.
    // Here we only apply: tab filter + symbol + direction + asset class.

    // Tab filter
    let list;
    switch (activeFilter) {
      case 'Wins':
        list = trades.filter(t => (t.total_realized_pnl || 0) > 0); break;
      case 'Losses':
        list = trades.filter(t => (t.total_realized_pnl || 0) <= 0); break;
      case 'Need matching':
        list = trades.filter(t => t.matching_status === 'needs_review'); break;
      case 'Planned':
        list = trades.filter(t => t.matching_status === 'matched'); break;
      case 'Off-plan':
        list = trades.filter(t => t.matching_status === 'off_plan'); break;
      case 'Not journalled':
        list = trades.filter(t => !t.review_notes); break;
      case 'Fully done':
        // Resolved (matched or off_plan) AND has review notes. The happy-path
        // terminus of the review pipeline.
        list = trades.filter(t => !!t.review_notes &&
          (t.matching_status === 'matched' || t.matching_status === 'off_plan')
        ); break;
      case 'All':
      default:
        list = trades;
    }

    // Symbol / direction / asset (client-side — symbol autocomplete needs these)
    const symQ = symbolQuery.trim().toUpperCase();
    return list.filter(t => {
      if (symQ) {
        const s = displaySymbol(t).toUpperCase();
        if (!s.includes(symQ)) return false;
      }
      if (directionFilter !== 'All' && t.direction !== directionFilter) return false;
      if (assetFilter !== 'All' && t.asset_category !== assetFilter) return false;
      return true;
    });
  }, [trades, activeFilter, symbolQuery, directionFilter, assetFilter]);

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

  const takenLoadingSkeleton = (
    <div className="animate-pulse">
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

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold text-gray-900">Smart Journal</h2>
      </div>

      {/* Section toggle: Taken / Missed / Playbooks */}
      <div className="inline-flex items-center bg-white border border-gray-200 rounded-xl p-1 mb-6">
        {SECTIONS.map(s => (
          <button
            key={s.key}
            onClick={() => setActiveSection(s.key)}
            className={`px-4 py-1.5 text-sm font-medium rounded-lg transition-colors ${
              activeSection === s.key
                ? 'bg-blue-600 text-white'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* MISSED — placeholder until the MissedTradeSheet ships */}
      {activeSection === 'missed' && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-10 text-center">
          <p className="text-sm font-semibold text-gray-700 mb-1">Missed trades coming next</p>
          <p className="text-xs text-gray-400 max-w-sm mx-auto">
            Log setups you spotted but didn&apos;t take. Tag them to a playbook to see what the missed ones
            would have done — and whether you tend to pass on winners.
          </p>
        </div>
      )}

      {/* PLAYBOOKS — CRUD */}
      {activeSection === 'playbooks' && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm text-gray-500">
              {playbooks.length === 0 ? 'No playbooks yet.' : `${playbooks.length} playbook${playbooks.length !== 1 ? 's' : ''}`}
            </p>
            <button
              onClick={() => { setEditingPlaybook(null); setPlaybookSheetOpen(true); }}
              className="bg-blue-600 text-white font-medium text-sm px-4 py-2 rounded-lg hover:bg-blue-700"
            >
              + New playbook
            </button>
          </div>

          {playbooksLoading ? (
            <div className="animate-pulse space-y-3">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
                  <div className="h-4 bg-gray-200 rounded w-40 mb-2" />
                  <div className="h-3 bg-gray-100 rounded w-full" />
                </div>
              ))}
            </div>
          ) : playbooks.length === 0 ? (
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-10 text-center">
              <p className="text-sm font-semibold text-gray-700 mb-1">Define your first setup</p>
              <p className="text-xs text-gray-400 max-w-md mx-auto mb-4">
                A playbook is a named, reusable pattern you want to track — e.g. &quot;MA30 Retracement Long&quot;.
                Tag plans and missed trades to a playbook and watch the stats accumulate over time.
              </p>
              <button
                onClick={() => { setEditingPlaybook(null); setPlaybookSheetOpen(true); }}
                className="bg-blue-600 text-white font-medium text-sm px-4 py-2 rounded-lg hover:bg-blue-700"
              >
                + New playbook
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {playbooks.map(pb => (
                <button
                  key={pb.id}
                  onClick={() => { setEditingPlaybook(pb); setPlaybookSheetOpen(true); }}
                  className="block w-full text-left bg-white rounded-xl p-4 shadow-sm border border-gray-100 hover:border-blue-200 hover:shadow-md transition-all"
                >
                  <p className="text-sm font-semibold text-gray-900">{pb.name}</p>
                  {pb.description && (
                    <p className="text-xs text-gray-500 mt-1 line-clamp-2">{pb.description}</p>
                  )}
                  <p className="text-[11px] text-gray-400 mt-2">
                    Updated {fmtDate(pb.updated_at)}
                  </p>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* TAKEN — the original Smart Journal content */}
      {activeSection === 'taken' && (loading ? takenLoadingSkeleton : (<>

      {(() => {
        // Cards reflect the journal workflow: how many trades, how far along on
        // matching, how far along on journalling. Each card's click takes you
        // to the "gap" — the trades still needing that step.
        const matchedCount = closedTrades.filter(t => t.matching_status === 'matched').length;
        const journalledCount = closedTrades.filter(t => t.review_notes).length;
        const total = closedTrades.length;
        return (
          <div className="grid grid-cols-3 gap-4 mb-6">
            {[
              { label: 'Trades', value: total > 0 ? String(total) : '—', color: 'text-gray-900', onClick: null },
              {
                label: 'Matched to plan',
                value: total > 0 ? `${matchedCount} / ${total}` : '—',
                color: 'text-blue-600',
                onClick: matchedCount < total ? () => setActiveFilter('Need matching') : null,
              },
              {
                label: 'Journalled',
                value: total > 0 ? `${journalledCount} / ${total}` : '—',
                color: 'text-green-600',
                onClick: journalledCount < total ? () => setActiveFilter('Not journalled') : null,
              },
            ].map(c => (
              <div
                key={c.label}
                onClick={c.onClick || undefined}
                className={`bg-white rounded-xl p-4 text-center shadow-sm border border-gray-100 ${
                  c.onClick ? 'cursor-pointer hover:border-blue-200 hover:shadow-md transition-all' : ''
                }`}
              >
                <p className="text-xs text-gray-400 mb-1">{c.label}</p>
                <p className={`text-2xl font-semibold ${c.color}`}>{c.value}</p>
              </div>
            ))}
          </div>
        );
      })()}

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
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-x-auto">
          {/* Sticky bulk-action bar — appears whenever at least one row is selected */}
          {selectedIds.size > 0 && (
            <div className="flex items-center justify-between px-6 py-3 bg-blue-50 border-b border-blue-100">
              <p className="text-sm font-medium text-blue-800">
                {selectedIds.size} selected
              </p>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleBulkMarkOffPlan}
                  disabled={bulkSaving}
                  className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60"
                >
                  {bulkSaving ? 'Saving…' : 'Mark as off-plan'}
                </button>
                <button
                  onClick={clearSelection}
                  disabled={bulkSaving}
                  className="text-xs font-medium px-3 py-1.5 rounded-lg text-blue-700 hover:bg-blue-100"
                >
                  Clear
                </button>
              </div>
            </div>
          )}
          <table className="w-full">
            <thead className="bg-gray-50">
              {/* Responsive column visibility:
                  - Always on:   Date, Symbol, P&L, Outcome
                  - sm: (≥640)  adds Direction, Plan, share
                  - md: (≥768)  adds checkbox, R, Adh, Journal
                  - Phones < sm see just 4 columns — scannable, no squish. */}
              <tr>
                <th className="hidden md:table-cell w-10 px-4 py-3" />
                <th className="px-4 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Date</th>
                <th className="px-4 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Symbol</th>
                <th className="hidden sm:table-cell px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Direction</th>
                <th className="hidden sm:table-cell px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Qty</th>
                <th className="px-4 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">P&L</th>
                <th className="hidden md:table-cell px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">R</th>
                <th className="hidden md:table-cell px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Adh</th>
                <th className="px-4 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Outcome</th>
                <th className="hidden sm:table-cell px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Plan</th>
                <th className="hidden md:table-cell px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Journal</th>
                <th className="hidden sm:table-cell px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map((trade) => {
                const isOpen = trade.status === 'open';
                // Each row is a single trade — show native currency, not base.
                const pnl = isOpen ? null : (trade.total_realized_pnl || 0);
                const isWin = (pnl || 0) > 0;
                const rowCurrency = trade.currency || baseCurrency;
                // P&L % of cost basis. Same math for LONG and SHORT since
                // total_realized_pnl already carries the sign.
                const qty = trade.total_closing_quantity || trade.total_opening_quantity || 0;
                const costBasis = (parseFloat(trade.avg_entry_price) || 0) * qty;
                const pnlPct = (!isOpen && costBasis > 0) ? (pnl / costBasis) * 100 : null;
                const plan = plansMap[trade.planned_trade_id];
                const rMultiple = isOpen ? null : calcR(trade, plan);
                const matchStatus = trade.matching_status;
                const dateDisplay = fmtDate(isOpen ? trade.opened_at : trade.closed_at);
                // Prefer the stored score; fall back to live compute if plan is loaded
                const adherence = isOpen
                  ? null
                  : (trade.adherence_score != null
                      ? trade.adherence_score
                      : (matchStatus === 'matched' && plan ? computeAdherenceScore(plan, trade) : null));

                const isExpanded = expandedTradeId === trade.id;
                const isBulkEligible = matchStatus === 'needs_review';
                const isChecked = selectedIds.has(trade.id);
                return (
                  <React.Fragment key={trade.id}>
                    <tr
                      className={`hover:bg-gray-50 cursor-pointer transition-colors ${
                        isChecked ? 'bg-blue-50/60' : isExpanded ? 'bg-blue-50/40' : ''
                      }`}
                      onClick={() => setExpandedTradeId(isExpanded ? null : trade.id)}
                    >
                      <td className="hidden md:table-cell w-10 px-4 py-4" onClick={e => e.stopPropagation()}>
                        {isBulkEligible ? (
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => toggleSelect(trade.id)}
                            className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-400 cursor-pointer"
                            title="Select for bulk action"
                          />
                        ) : null}
                      </td>
                      <td className="px-4 sm:px-6 py-4 text-sm text-gray-600 whitespace-nowrap">
                        <span className="inline-flex items-center gap-2">
                          <svg
                            className={`w-3 h-3 text-gray-300 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                            fill="none" stroke="currentColor" viewBox="0 0 24 24"
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
                          </svg>
                          {dateDisplay}
                        </span>
                      </td>
                      <td className="px-4 sm:px-6 py-4 text-sm font-semibold text-gray-900 whitespace-nowrap max-w-[10rem] truncate" title={trade.symbol}>
                        {fmtSymbol(trade)}
                      </td>
                      <td className="hidden sm:table-cell px-6 py-4 text-sm text-gray-600">{trade.direction}</td>
                      <td className="hidden sm:table-cell px-6 py-4 text-sm text-gray-600 whitespace-nowrap">
                        <PrivacyValue value={qty > 0 ? qty.toLocaleString() : '—'} />
                      </td>
                      <td className={`px-4 sm:px-6 py-4 text-sm font-semibold whitespace-nowrap ${isOpen ? 'text-gray-400' : isWin ? 'text-green-600' : 'text-red-500'}`}>
                        {isOpen ? '—' : (
                          <PrivacyValue value={
                            pnlPct != null
                              ? `${fmtPnl(pnl, rowCurrency)} / ${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(1)}%`
                              : fmtPnl(pnl, rowCurrency)
                          } />
                        )}
                      </td>
                      <td className="hidden md:table-cell px-6 py-4 text-sm text-gray-600">{rMultiple ?? '—'}</td>
                      <td className="hidden md:table-cell px-6 py-4">
                        <AdherencePill score={adherence} />
                      </td>
                      <td className="px-4 sm:px-6 py-4">
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
                      <td className="hidden sm:table-cell px-6 py-4">
                        {(() => {
                          const { label, cls } = planPillFor(trade);
                          return (
                            <span className={`px-2 py-0.5 text-xs rounded-full font-medium whitespace-nowrap ${cls}`}>
                              {label}
                            </span>
                          );
                        })()}
                      </td>
                      <td className="hidden md:table-cell px-6 py-4">
                        {isOpen ? null : trade.review_notes ? (
                          <span
                            className="inline-flex items-center gap-1.5 text-xs text-green-600 font-medium"
                            title={trade.review_notes}
                          >
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
                      <td className="hidden sm:table-cell px-4 py-4">
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
                    {isExpanded && (
                      <tr className="bg-gray-50">
                        <td colSpan={12} className="p-0">
                          <TradeInlineDetail
                            trade={trade}
                            plan={plan}
                            onSaved={handleTradeUpdated}
                            onCollapse={() => setExpandedTradeId(null)}
                          />
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      </>))}

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

      <PlaybookSheet
        isOpen={playbookSheetOpen}
        onClose={() => { setPlaybookSheetOpen(false); setEditingPlaybook(null); }}
        session={session}
        playbook={editingPlaybook}
        onSaved={loadPlaybooks}
      />
    </div>
  );
}

import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import * as Sentry from '@sentry/react';
import { supabase } from '../lib/supabaseClient';
import { fmtPrice, fmtPnl, fmtSymbol } from '../lib/formatters';
import { useBaseCurrency } from '../lib/BaseCurrencyContext';
import { useDataVersion, useInitialLoadTracker, useBumpDataVersion } from '../lib/DataVersionContext';
import PrivacyValue from '../components/PrivacyValue';
import ShareModal from '../components/ShareModal';
import LoadError from '../components/LoadError';

const statusStyles = {
  matched:      'bg-blue-50 text-blue-700',
  needs_review: 'bg-amber-50 text-amber-700',
  off_plan:     'bg-gray-100 text-gray-600',
};

const statusLabels = {
  matched:      'Matched',
  needs_review: 'Needs review',
  off_plan:     'Off-plan',
};

const fmtDateLabel = (dateKey) => {
  return new Date(dateKey + 'T12:00:00Z').toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  });
};

// Convert IBKR "20260408;100300" → ISO "2026-04-08T10:03:00Z"
// Parse a trade timestamp to a millisecond epoch. Accepts:
//   - timestamptz from Supabase: "2026-04-15 10:57:13+00" (post-migration)
//   - IBKR compact: "20260417;103045" (historical rows before the migration)
// Returning ms (not an ISO string) means downstream comparisons with
// logical_trade.opened_at/closed_at can use new Date(x).getTime() on the
// logical side too -- no format-mismatch bugs from lexicographic string
// compares between "X.000Z" and "X+00:00".
const parseTradeTime = (dt) => {
  if (!dt) return null;
  if (dt.length >= 10 && dt[4] === '-') {
    const ms = new Date(dt).getTime();
    return isNaN(ms) ? null : ms;
  }
  const [date, time] = dt.split(';');
  if (!date || date.length < 8) return null;
  const d = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;
  const t = time ? `${time.slice(0, 2)}:${time.slice(2, 4)}:${time.slice(4, 6)}` : '00:00:00';
  const ms = new Date(`${d}T${t}Z`).getTime();
  return isNaN(ms) ? null : ms;
};

// Weighted average price across a set of fills.
const weightedAvg = (fills) => {
  let qty = 0;
  let val = 0;
  for (const f of fills) {
    const q = Math.abs(parseFloat(f.quantity) || 0);
    const p = parseFloat(f.trade_price) || 0;
    qty += q;
    val += q * p;
  }
  return qty > 0 ? val / qty : null;
};

function AssetBadge({ category }) {
  if (category === 'STK') {
    return <span className="inline-flex items-center justify-center w-6 h-6 rounded text-xs font-bold bg-gray-100 text-gray-600">S</span>;
  }
  if (category === 'OPT') {
    return <span className="inline-flex items-center justify-center w-6 h-6 rounded text-xs font-bold bg-purple-100 text-purple-700">O</span>;
  }
  if (category === 'FXCFD' || category === 'CASH') {
    return <span className="inline-flex items-center justify-center h-6 px-1.5 rounded text-xs font-bold bg-blue-100 text-blue-700">FX</span>;
  }
  const label = category ? category.slice(0, 3) : '?';
  return <span className="inline-flex items-center justify-center h-6 px-1 rounded text-xs font-bold bg-gray-100 text-gray-500">{label}</span>;
}

const COL_SPAN = 10; // TYPE SYMBOL DIR BOUGHT SOLD POSITION P&L STATUS share chevron

// Collapse fills into one row per ib_order_id. Fills with no order id (rare:
// pre-migration manual entries) stay as-is -- each gets its own row. Within
// an order we show the earliest fill time, weighted-avg price, total qty,
// and sum of commissions -- a trader's-eye view instead of a fills log.
const aggregateByOrder = (fills) => {
  const rows = [];
  const byOrder = new Map();
  for (const f of fills) {
    if (!f.ib_order_id) {
      rows.push({ kind: 'fill', f });
      continue;
    }
    let bucket = byOrder.get(f.ib_order_id);
    if (!bucket) {
      bucket = { kind: 'order', orderId: f.ib_order_id, fills: [] };
      byOrder.set(f.ib_order_id, bucket);
      rows.push(bucket);
    }
    bucket.fills.push(f);
  }
  return rows
    .map((r) => {
      if (r.kind === 'fill') {
        const f = r.f;
        return {
          _ms: f._ms,
          price: parseFloat(f.trade_price) || 0,
          qty: Math.abs(parseFloat(f.quantity) || 0),
          buy_sell: f.buy_sell,
          commission: parseFloat(f.ib_commission),
          commissionCurrency: f.ib_commission_currency || f.currency,
          currency: f.currency,
          fillCount: 1,
        };
      }
      let qty = 0, notional = 0, commission = 0;
      let earliest = Infinity;
      for (const f of r.fills) {
        const q = Math.abs(parseFloat(f.quantity) || 0);
        const p = parseFloat(f.trade_price) || 0;
        qty += q;
        notional += q * p;
        const c = parseFloat(f.ib_commission);
        if (!isNaN(c)) commission += c;
        if (f._ms != null && f._ms < earliest) earliest = f._ms;
      }
      const first = r.fills[0];
      return {
        _ms: earliest === Infinity ? null : earliest,
        price: qty > 0 ? notional / qty : 0,
        qty,
        buy_sell: first.buy_sell,
        commission,
        commissionCurrency: first.ib_commission_currency || first.currency,
        currency: first.currency,
        fillCount: r.fills.length,
      };
    })
    .sort((a, b) => (a._ms ?? 0) - (b._ms ?? 0));
};

function ExecSubTable({ execs }) {
  if (!execs || execs.length === 0) {
    return (
      <tr>
        <td colSpan={COL_SPAN} className="px-6 py-3 bg-gray-50 border-t border-gray-100">
          <p className="text-xs text-gray-400 italic pl-6">No raw executions found for this day.</p>
        </td>
      </tr>
    );
  }

  const orderRows = aggregateByOrder(execs);

  return (
    <tr>
      <td colSpan={COL_SPAN} className="p-0 border-t border-gray-100">
        <div className="bg-gray-50 px-8 py-3">
          <table className="w-full">
            <thead>
              <tr>
                {['Time', 'Price', 'Qty', 'Type', 'Commission'].map(h => (
                  <th key={h} className="pb-1.5 text-left text-xs font-medium text-gray-400 uppercase tracking-wide pr-3">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {orderRows.map((r, i) => {
                const time = r._ms != null
                  ? new Date(r._ms).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
                  : '—';
                return (
                  <tr key={i} className="border-t border-gray-100">
                    <td className="py-1.5 pr-3 text-xs text-gray-600">
                      {time}
                      {r.fillCount > 1 && (
                        <span className="ml-1.5 text-[10px] text-gray-400">
                          {r.fillCount} fills
                        </span>
                      )}
                    </td>
                    <td className="py-1.5 pr-3 text-xs text-gray-800 font-medium">{fmtPrice(r.price, r.currency)}</td>
                    <td className="py-1.5 pr-3 text-xs text-gray-600"><PrivacyValue value={r.qty.toLocaleString()} /></td>
                    <td className="py-1.5 pr-3">
                      <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${r.buy_sell === 'BUY' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'}`}>
                        {r.buy_sell}
                      </span>
                    </td>
                    <td className="py-1.5 text-xs text-gray-500">
                      <PrivacyValue value={!isNaN(r.commission) && r.commission !== 0 ? fmtPnl(r.commission, r.commissionCurrency, 0) : '—'} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </td>
    </tr>
  );
}


function DayBlock({ day, plannedTradesMap = {}, baseCurrency = 'USD', userId, onReviewOpen }) {
  const [note, setNote] = useState(day.note);
  const [editingNote, setEditingNote] = useState(false);
  const [noteInput, setNoteInput] = useState(day.note || '');
  const [openResolve, setOpenResolve] = useState(null);
  const [expandedRows, setExpandedRows] = useState(new Set());
  const [shareRow, setShareRow] = useState(null);
  const bump = useBumpDataVersion();

  const toggleExpand = (id) => {
    setExpandedRows(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const openEditor = () => {
    setNoteInput(note || '');
    setEditingNote(true);
  };

  const handleSaveNote = async () => {
    const trimmed = noteInput.trim();
    setNote(trimmed);
    setEditingNote(false);
    const { error } = await supabase.from('daily_notes').upsert(
      { user_id: userId, date_key: day.dateKey, note: trimmed, updated_at: new Date().toISOString() },
      { onConflict: 'user_id,date_key' }
    );
    if (error) {
      console.error('[daily-notes] upsert failed:', error.message);
      alert(`Could not save daily note: ${error.message}`);
      return;
    }
    bump('notes');
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden mb-6">
      <div className="flex items-start justify-between px-6 py-4 border-b border-gray-100">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">{day.dateLabel}</h3>
          <p className="text-sm text-gray-500 mt-0.5">
            {day.trades} trade{day.trades !== 1 ? 's' : ''} &middot; {day.wins}W, {day.losses}L
            {day.needsReview > 0 && (
              <>
                {' · '}
                <span
                  role="button"
                  tabIndex={0}
                  onClick={onReviewOpen}
                  onKeyDown={e => e.key === 'Enter' && onReviewOpen?.()}
                  className="text-amber-600 font-medium cursor-pointer hover:text-amber-800 hover:underline"
                >
                  {day.needsReview} need review →
                </span>
              </>
            )}
          </p>
        </div>
        <div className="text-right">
          {/* Zero P&L on a day with no closed trades (e.g. only an open
              position was logged) should read neutral — a green "+€0" looks
              like a win. Only colour and sign when there's a real number. */}
          <p className={`text-2xl font-bold ${
            day.pnl > 0 ? 'text-green-600' : day.pnl < 0 ? 'text-red-500' : 'text-gray-400'
          }`}>
            <PrivacyValue value={day.pnl === 0 ? '—' : fmtPnl(day.pnl, baseCurrency, 0)} />
          </p>
          <p className="text-sm text-gray-400">Daily P&L</p>
        </div>
      </div>

      <div className="overflow-x-auto">
        {/* table-fixed + per-column widths: without these, each day block's
            table auto-sizes columns to its own content, so a day with
            "NVDA 160P 6 Apr" in the Symbol column pushes P&L / Status to
            different x-offsets than a day with just "NVDA". The Symbol
            column is intentionally left unwidthed so it flexes to soak up
            remaining space; everything else is pinned. */}
        <table className="w-full table-fixed">
          <thead className="bg-gray-50">
            <tr>
              {[
                { label: 'Type',     hide: true,  w: 'w-14' },
                { label: 'Symbol',   hide: false, w: ''      },
                { label: 'Dir',      hide: false, w: 'w-20' },
                { label: 'Bought',   hide: true,  w: 'w-36' },
                { label: 'Sold',     hide: true,  w: 'w-36' },
                { label: 'Position', hide: true,  w: 'w-28' },
                { label: 'P&L',      hide: false, w: 'w-24' },
                { label: 'Status',   hide: false, w: 'w-32' },
                { label: '',         hide: true,  w: 'w-12' },
                { label: '',         hide: false, w: 'w-10' },
              ].map((col, i) => (
                <th key={i} className={`px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider ${col.hide ? 'hidden sm:table-cell' : ''} ${col.w}`}>{col.label}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {day.rows.map((row) => {
              // Only needs_review trades need user action — off_plan trades
              // were auto-resolved (no plan candidates existed).
              const needsAction = row.status === 'needs_review';
              const isExpanded = expandedRows.has(row.id);
              const isFX = row.assetCategory === 'FXCFD' || row.assetCategory === 'CASH';
              const rowPnl = isFX ? row.realizedPnlBase : row.realizedPnlNative;
              const rowPnlCurrency = isFX ? baseCurrency : row.currency;
              const hasRealized = row.hasClosesToday;

              const boughtCell = row.buyQty > 0
                ? <><PrivacyValue value={Math.round(row.buyQty).toLocaleString()} /> @ {fmtPrice(row.buyAvgPrice, row.currency)}</>
                : '—';
              const soldCell = row.sellQty > 0
                ? <><PrivacyValue value={Math.round(row.sellQty).toLocaleString()} /> @ {fmtPrice(row.sellAvgPrice, row.currency)}</>
                : '—';

              return (
                <React.Fragment key={row.id}>
                  <tr
                    className={`cursor-pointer select-none ${needsAction ? 'bg-amber-50 hover:bg-amber-100' : 'hover:bg-gray-50'}`}
                    onClick={() => toggleExpand(row.id)}
                  >
                    <td className="hidden sm:table-cell px-4 py-3.5">
                      <AssetBadge category={row.assetCategory} />
                    </td>
                    <td className="px-4 py-3.5 text-sm font-medium text-gray-900">{fmtSymbol({ symbol: row.symbol, asset_category: row.assetCategory })}</td>
                    <td className="px-4 py-3.5 text-sm text-gray-600">{row.direction}</td>
                    <td className="hidden sm:table-cell px-4 py-3.5 text-sm text-gray-900">{boughtCell}</td>
                    <td className="hidden sm:table-cell px-4 py-3.5 text-sm text-gray-900">{soldCell}</td>
                    <td className="hidden sm:table-cell px-4 py-3.5 text-sm">
                      {row.posBefore != null && row.posAfter != null ? (() => {
                        // Signed display: shorts render negative ("-30 → 0"),
                        // longs positive. Zero is unsigned regardless of
                        // direction -- "-0" reads as a bug, not a quantity.
                        const sign = row.direction === 'SHORT' ? -1 : 1;
                        const fmt = (raw) => {
                          const n = Math.round(raw);
                          if (n === 0) return '0';
                          return (n * sign).toLocaleString();
                        };
                        return (
                          <>
                            <span className="text-xs text-gray-400">
                              <PrivacyValue value={fmt(row.posBefore)} />
                            </span>
                            <span className="mx-1 text-xs text-gray-300">→</span>
                            <span className="font-medium text-gray-700">
                              <PrivacyValue value={fmt(row.posAfter)} />
                            </span>
                          </>
                        );
                      })() : '—'}
                    </td>
                    <td className={`px-4 py-3.5 text-sm font-medium ${hasRealized ? ((rowPnl || 0) >= 0 ? 'text-green-600' : 'text-red-500') : 'text-gray-400'}`}>
                      {hasRealized ? <PrivacyValue value={fmtPnl(rowPnl, rowPnlCurrency, 0)} /> : '—'}
                    </td>
                    <td className="px-4 py-3.5" onClick={e => e.stopPropagation()}>
                      <div className="flex items-center space-x-2">
                        <span className={`px-2 py-0.5 text-xs rounded-full font-medium ${statusStyles[row.status] || 'bg-gray-100 text-gray-500'}`}>
                          {statusLabels[row.status] || row.status}
                        </span>
                        {needsAction && (
                          <button
                            onClick={() => setOpenResolve(openResolve === row.id ? null : row.id)}
                            className="text-xs text-blue-600 font-medium hover:underline whitespace-nowrap"
                          >
                            Resolve &rarr;
                          </button>
                        )}
                      </div>
                    </td>
                    <td className="hidden sm:table-cell px-2 py-3.5" onClick={e => e.stopPropagation()}>
                      {row.isCloseDay && (
                        <button
                          onClick={(e) => { e.stopPropagation(); setShareRow(row); }}
                          title="Share on X"
                          className="p-1.5 text-gray-300 hover:text-blue-500 hover:bg-blue-50 rounded-lg transition-colors"
                        >
                          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.74l7.73-8.835L1.254 2.25H8.08l4.259 5.632 5.905-5.632zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                          </svg>
                        </button>
                      )}
                    </td>
                    <td className="px-4 py-3.5 text-gray-300 text-sm">
                      <svg
                        className={`w-4 h-4 transition-transform duration-150 ${isExpanded ? 'rotate-90' : ''}`}
                        fill="none" stroke="currentColor" viewBox="0 0 24 24"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    </td>
                  </tr>

                  {isExpanded && <ExecSubTable execs={row.fills} />}

                  {needsAction && openResolve === row.id && (
                    <tr className="bg-amber-50">
                      <td colSpan={COL_SPAN} className="px-6 py-3">
                        <div className="bg-white rounded-xl p-4 border border-purple-200">
                          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
                            Resolve {fmtSymbol({ symbol: row.symbol, asset_category: row.assetCategory })}
                          </p>
                          <p className="text-sm text-gray-500 mb-3">
                            Multiple plans matched this trade. Open the Review wizard to pick one.
                          </p>
                          <div className="flex space-x-2">
                            <button onClick={() => setOpenResolve(null)} className="border border-gray-200 text-gray-600 text-xs px-4 py-2 rounded-lg hover:bg-gray-50">Cancel</button>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {editingNote ? (
        <div className="px-6 py-4 border-t border-blue-100 bg-blue-50">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-sm font-semibold text-gray-700">Daily journal</h4>
            <button
              onClick={() => setEditingNote(false)}
              className="text-xs text-gray-500 hover:text-gray-700"
            >
              ✕ Close
            </button>
          </div>
          <textarea
            value={noteInput}
            onChange={e => setNoteInput(e.target.value)}
            placeholder="What went well? What did you miss? Any patterns you noticed today..."
            rows={3}
            autoFocus
            className="w-full text-sm border border-blue-200 rounded-lg p-3 bg-white focus:outline-none focus:ring-2 focus:ring-blue-400 resize-none"
          />
          <div className="flex items-center justify-between mt-2">
            <p className="text-xs text-gray-400">Visible in Daily View and Journal.</p>
            <button
              onClick={handleSaveNote}
              className="bg-blue-600 text-white text-xs font-medium px-4 py-1.5 rounded-lg hover:bg-blue-700"
            >
              Save journal
            </button>
          </div>
        </div>
      ) : (
        <div className="px-6 py-2.5 border-t border-gray-100 bg-gray-50 flex items-center justify-between gap-3">
          <p className={`text-xs min-w-0 truncate ${note ? 'text-gray-700' : 'text-gray-500 italic'}`}>
            {note || 'No journal entry for this day'}
          </p>
          <button
            onClick={openEditor}
            className="inline-flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-800 font-medium whitespace-nowrap flex-shrink-0"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
            <span>{note ? 'Edit' : 'Write'}</span>
          </button>
        </div>
      )}

      {shareRow && (() => {
        // ShareModal renders a whole closed trade's P&L, entry/exit, qty, etc.
        // A day-row only holds that day's activity -- when the user hits
        // Share on the close-day row, synthesize the LT-level fields
        // ShareModal expects (entry, exit, qty, closingQty, nativePnl).
        const lt = shareRow.parentLt;
        const shareShape = {
          symbol: lt.symbol,
          direction: lt.direction,
          assetCategory: lt.asset_category,
          currency: lt.currency,
          entry: lt.avg_entry_price ?? null,
          exit: lt.avg_exit_price ?? null,
          qty: lt.total_opening_quantity ?? null,
          closingQty: lt.total_closing_quantity ?? null,
          nativePnl: lt.total_realized_pnl,
        };
        return (
          <ShareModal
            row={shareShape}
            plannedStop={plannedTradesMap[lt.planned_trade_id]?.planned_stop_loss ?? null}
            baseCurrency={baseCurrency}
            onClose={() => setShareRow(null)}
          />
        );
      })()}
    </div>
  );
}

export default function DailyViewScreen({ session, refreshKey = 0 }) {
  const userId = session?.user?.id;
  const navigate = useNavigate();
  const onReviewOpen = () => navigate('/review');
  const baseCurrency = useBaseCurrency();
  const [trades, setTrades] = useState([]);
  const [rawTrades, setRawTrades] = useState([]);
  const [plannedTradesMap, setPlannedTradesMap] = useState({});
  const [dailyNotes, setDailyNotes] = useState({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [search, setSearch] = useState('');
  const [dateFilter, setDateFilter] = useState('all');
  const [sortAsc, setSortAsc] = useState(false);
  // Asset-class filters. Default all on — the UI reads "hide X" more naturally
  // than "only show X". Each toggle mirrors the AssetBadge used in the Type
  // column, so the filter pill and the row badge use the same visual language.
  const [assetFilters, setAssetFilters] = useState({ STK: true, FX: true, OPT: true });

  // Default window: last 30 days. Prevents fetching entire trade history.
  // Raw trades use IBKR's YYYYMMDD;HHMMSS format, so string comparison works.
  const [dvWindow, setDvWindow] = useState(30); // days

  // Cross-screen data invalidation — refetch silently when watched tables
  // are mutated elsewhere. See lib/DataVersionContext for the key map.
  const [tradesV, notesV] = useDataVersion('trades', 'notes');
  const loadTracker = useInitialLoadTracker(reloadKey);

  useEffect(() => {
    if (!userId) return;
    const isInitial = loadTracker.isInitial;
    if (isInitial) setLoading(true);
    setLoadError(null);

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - dvWindow);
    const isoDate = cutoff.toISOString().slice(0, 10);   // '2026-03-17'
    const ibkrDate = isoDate.replace(/-/g, '');           // '20260317'

    const load = async () => {
      try {
        const [logicalRes, rawRes, plansRes, notesRes] = await Promise.all([
          supabase
            .from('logical_trades')
            .select('*')
            .eq('user_id', userId)
            // Fetch (a) any LT active now (so scale-ins on an old open position
            // are linkable) and (b) any LT whose open OR close falls in window.
            .or(`status.eq.open,opened_at.gte.${isoDate},closed_at.gte.${isoDate}`)
            .order('opened_at', { ascending: false, nullsFirst: false }),
          supabase
            .from('trades')
            .select('id, ib_exec_id, ib_order_id, conid, symbol, trade_price, quantity, buy_sell, open_close_indicator, date_time, ib_commission, ib_commission_currency, currency, fifo_pnl_realized')
            .eq('user_id', userId)
            .gte('date_time', ibkrDate),
          supabase
            .from('planned_trades')
            .select('id, planned_stop_loss')
            .eq('user_id', userId),
          supabase
            .from('daily_notes')
            .select('date_key, note')
            .eq('user_id', userId)
            .gte('date_key', isoDate),
        ]);
        if (logicalRes.error) throw logicalRes.error;
        if (rawRes.error) throw rawRes.error;
        if (plansRes.error) throw plansRes.error;
        if (notesRes.error) throw notesRes.error;

        // logical_trade_executions used to be queried here as a primary
        // path for trade -> LT attribution. Removed 2026-04-25 after a
        // schema audit found the table is empty and no code in this repo
        // writes to it. The conid + time-window fallback (resolveLt
        // below) was always doing the actual work; the LTE round-trip
        // was a wasted network call.

        setTrades(logicalRes.data || []);
        setRawTrades(rawRes.data || []);
        const map = {};
        for (const p of (plansRes.data || [])) map[p.id] = p;
        setPlannedTradesMap(map);
        const notesMap = {};
        for (const n of (notesRes.data || [])) notesMap[n.date_key] = n.note;
        setDailyNotes(notesMap);
      } catch (err) {
        console.error('[daily-view] load failed:', err?.message || err);
        Sentry.withScope((scope) => {
          scope.setTag('screen', 'daily-view');
          scope.setTag('step', 'load');
          scope.setTag('load_kind', isInitial ? 'initial' : 'silent-refetch');
          Sentry.captureException(err instanceof Error ? err : new Error(String(err)));
        });
        if (isInitial) setLoadError(err?.message || 'Could not load daily trades.');
      } finally {
        if (isInitial) setLoading(false);
        loadTracker.markLoaded();
      }
    };
    load();
  }, [userId, refreshKey, dvWindow, reloadKey, tradesV, notesV]); // eslint-disable-line react-hooks/exhaustive-deps

  const ltById = useMemo(() => {
    const m = {};
    for (const t of trades) m[t.id] = t;
    return m;
  }, [trades]);

  // Index LTs by conid for fast fallback lookup when the LTE join didn't
  // resolve a raw trade -> LT mapping (e.g., data synced before FIFO was
  // run, demo data, edge cases). Matches the old getExecs behaviour.
  const ltsByConid = useMemo(() => {
    const m = {};
    for (const t of trades) {
      if (t.conid == null) continue;
      if (!m[t.conid]) m[t.conid] = [];
      m[t.conid].push(t);
    }
    return m;
  }, [trades]);

  const days = useMemo(() => {
    const assetMatch = (cat) => {
      if (cat === 'STK') return assetFilters.STK;
      if (cat === 'OPT') return assetFilters.OPT;
      if (cat === 'FXCFD' || cat === 'CASH') return assetFilters.FX;
      return true;
    };

    const resolveLt = (rawTrade, ms) => {
      // Match a raw trade to its parent LT by conid + time within the
      // LT's open window. (Used to be a two-step path with the LTE join
      // as the primary lookup, but that table is dead in this repo --
      // see load() comment.)
      const candidates = ltsByConid[rawTrade.conid] || [];
      for (const lt of candidates) {
        const startMs = lt.opened_at ? new Date(lt.opened_at).getTime() : 0;
        const endMs   = lt.closed_at ? new Date(lt.closed_at).getTime() : Date.now();
        if (ms >= startMs && ms <= endMs) return lt.id;
      }
      return null;
    };

    // Build (ltId, dateKey) groups from raw trades. Each group = one day-row:
    // all of the user's activity on that LT on that day.
    const groups = new Map();
    for (const t of rawTrades) {
      const ms = parseTradeTime(t.date_time);
      if (ms == null) continue;
      const ltId = resolveLt(t, ms);
      if (!ltId) continue;
      const lt = ltById[ltId];
      if (!lt) continue;
      if (!assetMatch(lt.asset_category)) continue;
      if (search && !(lt.symbol || '').toLowerCase().includes(search.toLowerCase())) continue;
      const dateKey = new Date(ms).toISOString().slice(0, 10);
      const key = `${ltId}|${dateKey}`;
      let g = groups.get(key);
      if (!g) {
        g = { ltId, dateKey, lt, fills: [] };
        groups.set(key, g);
      }
      g.fills.push({ ...t, _ms: ms });
    }

    // Compute pre/post absolute position per (LT, day) for the Position
    // column. Walk each LT's in-window day-totals chronologically. Position
    // at start of window is derived from current state:
    //   pos_at_window_start = lt.remaining_quantity
    //                       - sum(in-window opens)
    //                       + sum(in-window closes)
    // (proof: lt.remaining_quantity == abs_position_now;
    //  abs_position_now == abs_position_at_window_start
    //                    + sum(in-window opens) - sum(in-window closes);
    //  rearrange.) From there, walking forward day by day gives the
    //  position before and after each day's activity.
    //
    // Pre-window fills don't need to be available in rawTrades -- they're
    // already baked into lt.remaining_quantity / total_opening_quantity /
    // total_closing_quantity.
    const positionByGroupKey = new Map();
    const ltDayTotals = new Map();
    for (const g of groups.values()) {
      const opensQty = g.fills
        .filter(f => (f.open_close_indicator || '').includes('O'))
        .reduce((s, f) => s + Math.abs(parseFloat(f.quantity) || 0), 0);
      const closesQty = g.fills
        .filter(f => (f.open_close_indicator || '').includes('C'))
        .reduce((s, f) => s + Math.abs(parseFloat(f.quantity) || 0), 0);
      if (!ltDayTotals.has(g.ltId)) ltDayTotals.set(g.ltId, []);
      ltDayTotals.get(g.ltId).push({ dateKey: g.dateKey, opensQty, closesQty });
    }
    for (const [ltId, days] of ltDayTotals.entries()) {
      const lt = ltById[ltId];
      if (!lt) continue;
      days.sort((a, b) => a.dateKey.localeCompare(b.dateKey));
      const totalOpens  = days.reduce((s, d) => s + d.opensQty, 0);
      const totalCloses = days.reduce((s, d) => s + d.closesQty, 0);
      const remaining = Math.abs(parseFloat(lt.remaining_quantity) || 0);
      let pos = remaining - totalOpens + totalCloses;  // window-start position
      for (const d of days) {
        const before = pos;
        pos = pos + d.opensQty - d.closesQty;
        positionByGroupKey.set(`${ltId}|${d.dateKey}`, { before, after: pos });
      }
    }

    // Materialise each group into a day-row.
    const rowsByDate = new Map();
    for (const g of groups.values()) {
      const { lt, fills, dateKey } = g;
      fills.sort((a, b) => a._ms - b._ms);
      const buys  = fills.filter(f => f.buy_sell === 'BUY');
      const sells = fills.filter(f => f.buy_sell === 'SELL');
      const buyQty  = buys.reduce((s, f) => s + Math.abs(parseFloat(f.quantity) || 0), 0);
      const sellQty = sells.reduce((s, f) => s + Math.abs(parseFloat(f.quantity) || 0), 0);
      // Realised P&L = sum of fifo_pnl_realized on closing fills today.
      // Closing = opposite side of the LT's direction (SELL for LONG, BUY for
      // SHORT). open_close_indicator from IBKR is also checked for safety.
      const closingFills = fills.filter(f => (f.open_close_indicator || '').includes('C'));
      const realizedPnlNative = closingFills.reduce((s, f) => s + (parseFloat(f.fifo_pnl_realized) || 0), 0);
      const fxRate = parseFloat(lt.fx_rate_to_base) || 1;
      const realizedPnlBase = realizedPnlNative * fxRate;

      const positionInfo = positionByGroupKey.get(`${lt.id}|${dateKey}`) || { before: null, after: null };

      const row = {
        id: `${lt.id}_${dateKey}`,
        parentLt: lt,
        dateKey,
        symbol: lt.symbol,
        direction: lt.direction,
        currency: lt.currency,
        assetCategory: lt.asset_category,
        buyQty,
        buyAvgPrice: buyQty > 0 ? weightedAvg(buys) : null,
        sellQty,
        sellAvgPrice: sellQty > 0 ? weightedAvg(sells) : null,
        posBefore: positionInfo.before,
        posAfter: positionInfo.after,
        realizedPnlNative,
        realizedPnlBase,
        // A row has realised P&L to show if any closing fills landed today.
        // This covers both LONG (closing fill = SELL) and SHORT (closing = BUY)
        // -- keying off just sellQty would miss SHORT closes.
        hasClosesToday: closingFills.length > 0,
        isCloseDay: lt.status === 'closed' && (lt.closed_at || '').slice(0, 10) === dateKey,
        status: lt.matching_status || 'needs_review',
        fills,
      };
      if (!rowsByDate.has(dateKey)) rowsByDate.set(dateKey, []);
      rowsByDate.get(dateKey).push(row);
    }

    let result = Array.from(rowsByDate.entries()).map(([dateKey, rows]) => {
      const totalPnl = rows.reduce((sum, r) => sum + (r.realizedPnlBase || 0), 0);
      const closedRows = rows.filter(r => r.hasClosesToday);
      const wins = closedRows.filter(r => (r.realizedPnlBase || 0) > 0).length;
      const losses = closedRows.filter(r => (r.realizedPnlBase || 0) < 0).length;
      // needsReview counts unique LTs active today that still need review.
      const needsReviewLts = new Set(
        rows.filter(r => r.status === 'needs_review').map(r => r.parentLt.id)
      );
      return {
        dateKey,
        dateLabel: fmtDateLabel(dateKey),
        rows,
        trades: rows.length,
        wins,
        losses,
        pnl: totalPnl,
        needsReview: needsReviewLts.size,
        note: dailyNotes[dateKey] || null,
      };
    });

    result = result.filter(d => dateFilter === 'all' || d.dateKey === dateFilter);
    result.sort((a, b) => sortAsc
      ? a.dateKey.localeCompare(b.dateKey)
      : b.dateKey.localeCompare(a.dateKey)
    );

    return result;
  }, [rawTrades, ltById, ltsByConid, search, dateFilter, sortAsc, dailyNotes, assetFilters]);

  const uniqueDates = useMemo(() => {
    const set = new Set();
    for (const t of rawTrades) {
      const ms = parseTradeTime(t.date_time);
      if (ms != null) set.add(new Date(ms).toISOString().slice(0, 10));
    }
    return [...set].sort().reverse();
  }, [rawTrades]);

  const totalNeedsReview = useMemo(() =>
    trades.filter(t => t.matching_status === 'needs_review').length,
    [trades]
  );

  if (loadError) {
    return (
      <div>
        <h2 className="text-xl font-semibold text-gray-900 mb-4">Daily view</h2>
        <LoadError title="Could not load daily trades" message={loadError} onRetry={() => setReloadKey(k => k + 1)} />
      </div>
    );
  }

  if (loading) {
    return (
      <div className="animate-pulse">
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 mb-6">
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            {[...Array(4)].map((_, i) => <div key={i} className="h-9 bg-gray-200 rounded-lg" />)}
          </div>
        </div>
        {[...Array(2)].map((_, i) => (
          <div key={i} className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden mb-6">
            <div className="flex items-start justify-between px-6 py-4 border-b border-gray-100">
              <div>
                <div className="h-5 bg-gray-200 rounded w-48 mb-2" />
                <div className="h-3 bg-gray-200 rounded w-32" />
              </div>
              <div className="h-8 bg-gray-200 rounded w-20" />
            </div>
            <div className="p-4 space-y-3">
              {[...Array(3)].map((_, j) => <div key={j} className="h-12 bg-gray-100 rounded" />)}
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div>
      {totalNeedsReview > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-5 py-3.5 mb-6 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-2 h-2 rounded-full bg-amber-400 flex-shrink-0" />
            <p className="text-sm font-medium text-amber-800">
              {totalNeedsReview} trade{totalNeedsReview !== 1 ? 's' : ''} need{totalNeedsReview === 1 ? 's' : ''} review
            </p>
          </div>
          <button
            onClick={onReviewOpen}
            className="text-sm font-semibold text-amber-700 hover:text-amber-900 whitespace-nowrap"
          >
            Review all →
          </button>
        </div>
      )}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 mb-6">
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
          <div className="relative">
            <svg className="w-4 h-4 absolute left-3 top-3 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              placeholder="Search symbols..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-gray-50"
            />
          </div>
          <select
            value={dateFilter}
            onChange={e => setDateFilter(e.target.value)}
            className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-gray-50 text-gray-700"
          >
            <option value="all">All Dates</option>
            {uniqueDates.map(d => (
              <option key={d} value={d}>{new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</option>
            ))}
          </select>
          <button
            onClick={() => setSortAsc(v => !v)}
            className="flex items-center justify-center space-x-2 px-3 py-2 border border-gray-200 rounded-lg text-sm text-gray-700 bg-gray-50 hover:bg-gray-100"
          >
            <svg className={`w-4 h-4 transition-transform ${sortAsc ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
            <span>{sortAsc ? 'Oldest first' : 'Newest first'}</span>
          </button>
          <div className="flex items-center gap-2">
            {[
              { key: 'STK', label: 'Stocks',  onCls: 'bg-gray-100 text-gray-700 border-gray-200',     offCls: 'bg-white text-gray-400 border-gray-200' },
              { key: 'FX',  label: 'FX',      onCls: 'bg-blue-100 text-blue-700 border-blue-200',     offCls: 'bg-white text-gray-400 border-gray-200' },
              { key: 'OPT', label: 'Options', onCls: 'bg-purple-100 text-purple-700 border-purple-200', offCls: 'bg-white text-gray-400 border-gray-200' },
            ].map(({ key, label, onCls, offCls }) => {
              const active = assetFilters[key];
              return (
                <button
                  key={key}
                  onClick={() => setAssetFilters(f => ({ ...f, [key]: !f[key] }))}
                  aria-pressed={active}
                  title={active ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
                  className={`inline-flex items-center px-2.5 h-8 rounded text-xs font-semibold border transition-colors ${active ? onCls : offCls}`}
                >
                  {label}
                </button>
              );
            })}
            {(search || dateFilter !== 'all' || !assetFilters.STK || !assetFilters.FX || !assetFilters.OPT) && (
              <button
                onClick={() => { setSearch(''); setDateFilter('all'); setAssetFilters({ STK: true, FX: true, OPT: true }); }}
                className="ml-auto text-xs font-medium text-gray-500 hover:text-gray-800 px-2 py-1 rounded hover:bg-gray-100"
              >
                Clear
              </button>
            )}
          </div>
        </div>
      </div>

      {days.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 px-5 py-12 text-center">
          <p className="text-sm font-medium text-gray-500 mb-1">No trades found</p>
          <p className="text-xs text-gray-400">Sync your IBKR account to import trades</p>
        </div>
      ) : (
        <>
          {days.map(day => (
            <DayBlock key={day.dateKey} day={day} plannedTradesMap={plannedTradesMap} baseCurrency={baseCurrency} userId={session.user.id} onReviewOpen={onReviewOpen} />
          ))}
          <button
            type="button"
            onClick={() => setDvWindow(w => w + 30)}
            className="w-full text-center text-xs font-medium text-blue-600 hover:bg-gray-50 py-3 mt-4 border border-gray-200 rounded-xl"
          >
            Load older trades (currently showing last {dvWindow} days)
          </button>
        </>
      )}
    </div>
  );
}

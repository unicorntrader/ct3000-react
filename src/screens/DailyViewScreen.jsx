import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import * as Sentry from '@sentry/react';
import { supabase } from '../lib/supabaseClient';
import { pnlBase, fmtPrice, fmtPnl, fmtSymbol } from '../lib/formatters';
import { useBaseCurrency } from '../lib/BaseCurrencyContext';
import { useDataVersion, useInitialLoadTracker, useBumpDataVersion } from '../lib/DataVersionContext';
import PrivacyValue from '../components/PrivacyValue';
import ShareModal from '../components/ShareModal';
import LoadError from '../components/LoadError';

const statusStyles = {
  matched:      'bg-blue-50 text-blue-600',
  needs_review: 'bg-amber-100 text-amber-700',
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

const calcDuration = (openedAt, closedAt) => {
  // Open position: we know when it opened but not when (or if) it closes.
  // Show "Open" instead of "—" so the trader does not have to cross-check
  // the Exit column to realise the trade is still live.
  if (openedAt && !closedAt) return 'Open';
  if (!openedAt || !closedAt) return '—';
  const diffMs = new Date(closedAt) - new Date(openedAt);
  if (diffMs < 0) return '—';
  const hours = diffMs / (1000 * 60 * 60);
  if (hours < 1) return 'Intraday';
  if (hours < 24) return 'Day';
  return 'Swing';
};

// Build exit price map + set of order IDs that have real opening trades.
const buildExitInfo = (logicalTrades, rawTrades) => {
  const closing = rawTrades
    .filter(t => (t.open_close_indicator || '').includes('C'))
    .map(t => ({ ...t, _ms: parseTradeTime(t.date_time) }))
    .filter(t => t._ms != null);

  const exitMap = {};
  for (const lt of logicalTrades) {
    if (lt.status !== 'closed') continue;
    const opp = lt.direction === 'LONG' ? 'SELL' : 'BUY';
    const startMs = lt.opened_at ? new Date(lt.opened_at).getTime() : 0;
    const endMs   = lt.closed_at ? new Date(lt.closed_at).getTime() : Infinity;
    const matches = closing.filter(t =>
      t.symbol === lt.symbol &&
      t.buy_sell === opp &&
      t._ms >= startMs &&
      t._ms <= endMs
    );
    if (matches.length === 0) continue;
    const totalQty = matches.reduce((s, t) => s + Math.abs(parseFloat(t.quantity) || 0), 0);
    const totalVal = matches.reduce((s, t) =>
      s + Math.abs(parseFloat(t.quantity) || 0) * (parseFloat(t.trade_price) || 0), 0);
    if (totalQty > 0) exitMap[lt.id] = totalVal / totalQty;
  }

  const openOrderIds = new Set(
    rawTrades
      .filter(t => (t.open_close_indicator || '').includes('O'))
      .map(t => t.ib_order_id)
      .filter(Boolean)
  );

  return { exitMap, openOrderIds };
};

const getDisplayPrices = (trade, exitMap, openOrderIds) => {
  if (trade.status === 'open') {
    return { entry: trade.avg_entry_price, exit: null, isOrphan: false };
  }
  const exitFromRaw = exitMap[trade.id] ?? null;
  const isOrphan = !openOrderIds.has(trade.opening_ib_order_id);
  if (isOrphan) {
    return { entry: null, exit: exitFromRaw, isOrphan: true };
  }
  return { entry: trade.avg_entry_price, exit: exitFromRaw, isOrphan: false };
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

const COL_SPAN = 11; // TYPE SYMBOL DIR ENTRY EXIT QTY DURATION P&L STATUS share chevron

function ExecSubTable({ execs, orphanQty = 0, orphanSide = null }) {
  if ((!execs || execs.length === 0) && orphanQty === 0) {
    return (
      <tr>
        <td colSpan={COL_SPAN} className="px-6 py-3 bg-gray-50 border-t border-gray-100">
          <p className="text-xs text-gray-400 italic pl-6">No raw executions found for this trade.</p>
        </td>
      </tr>
    );
  }

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
              {orphanQty > 0 && (
                // Synthetic row for the pre-window portion. Not a real execution
                // (we don't have it in the trades table), so styled muted + italic
                // and labelled with "Before window" instead of a timestamp.
                <tr className="border-t border-gray-100 first:border-0 bg-amber-50/40">
                  <td className="py-1.5 pr-3 text-xs text-amber-700 italic">Before window</td>
                  <td className="py-1.5 pr-3 text-xs text-gray-400 italic">—</td>
                  <td className="py-1.5 pr-3 text-xs text-gray-700 italic"><PrivacyValue value={Math.round(orphanQty).toLocaleString()} /></td>
                  <td className="py-1.5 pr-3">
                    <span className={`text-xs font-medium px-1.5 py-0.5 rounded italic ${orphanSide === 'BUY' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'}`}>
                      {orphanSide || '—'}
                    </span>
                  </td>
                  <td className="py-1.5 text-xs text-gray-400 italic">—</td>
                </tr>
              )}
              {(execs || []).map((ex, i) => {
                const time = ex._ms != null
                  ? new Date(ex._ms).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
                  : '—';
                const commission = parseFloat(ex.ib_commission);
                return (
                  <tr key={i} className="border-t border-gray-100">
                    <td className="py-1.5 pr-3 text-xs text-gray-600">{time}</td>
                    <td className="py-1.5 pr-3 text-xs text-gray-800 font-medium">{fmtPrice(parseFloat(ex.trade_price), ex.currency)}</td>
                    <td className="py-1.5 pr-3 text-xs text-gray-600"><PrivacyValue value={Math.abs(parseFloat(ex.quantity) || 0).toLocaleString()} /></td>
                    <td className="py-1.5 pr-3">
                      <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${ex.buy_sell === 'BUY' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'}`}>
                        {ex.buy_sell}
                      </span>
                    </td>
                    <td className="py-1.5 text-xs text-gray-500">
                      <PrivacyValue value={!isNaN(commission) ? fmtPnl(commission, ex.ib_commission_currency || ex.currency, 0) : '—'} />
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


function DayBlock({ day, rawTradesWithIso, onResolve, plannedTradesMap = {}, baseCurrency = 'USD', userId, onReviewOpen }) {
  const [note, setNote] = useState(day.note);
  const [editingNote, setEditingNote] = useState(false);
  const [noteInput, setNoteInput] = useState(day.note || '');
  const [journalInput, setJournalInput] = useState('');
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

  const persistNote = async (text) => {
    const { error } = await supabase.from('daily_notes').upsert(
      { user_id: userId, date_key: day.dateKey, note: text, updated_at: new Date().toISOString() },
      { onConflict: 'user_id,date_key' }
    );
    if (error) {
      console.error('[daily-notes] upsert failed:', error.message);
      alert(`Could not save daily note: ${error.message}`);
      return;
    }
    bump('notes');
  };

  const handleSaveNote = async () => {
    const trimmed = noteInput.trim();
    setNote(trimmed);
    setEditingNote(false);
    await persistNote(trimmed);
  };

  const handleSaveJournal = async () => {
    if (!journalInput.trim()) return;
    const trimmed = journalInput.trim();
    setNote(trimmed);
    setJournalInput('');
    await persistNote(trimmed);
  };

  // Get all executions for a logical trade by conid + date window
  const getExecs = (row) => {
    const { conid, openedAt, closedAt } = row;
    if (!conid) return [];
    const startMs = openedAt ? new Date(openedAt).getTime() : 0;
    const endMs = closedAt ? new Date(closedAt).getTime() : Date.now();
    return rawTradesWithIso.filter(t =>
      t.conid === conid &&
      t._ms != null &&
      t._ms >= startMs &&
      t._ms <= endMs
    );
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

      {note && !editingNote && (
        <div className="px-6 py-4 bg-blue-50 border-b border-blue-100">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-sm font-semibold text-gray-700">Daily Notes</h4>
            <button
              onClick={() => { setNoteInput(note); setEditingNote(true); }}
              className="flex items-center space-x-1 text-sm text-blue-600 hover:text-blue-800 font-medium"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
              <span>Edit</span>
            </button>
          </div>
          <p className="text-sm text-gray-700 leading-relaxed">{note}</p>
        </div>
      )}

      {editingNote && (
        <div className="px-6 py-4 bg-blue-50 border-b border-blue-100">
          <textarea
            rows={3}
            value={noteInput}
            onChange={e => setNoteInput(e.target.value)}
            className="w-full text-sm border border-blue-200 rounded-lg p-3 bg-white focus:outline-none focus:ring-2 focus:ring-blue-400 resize-none"
          />
          <div className="flex space-x-2 mt-2">
            <button onClick={handleSaveNote} className="text-xs bg-blue-600 text-white px-4 py-1.5 rounded-lg font-medium hover:bg-blue-700">Save note</button>
            <button onClick={() => setEditingNote(false)} className="text-xs border border-gray-200 px-4 py-1.5 rounded-lg text-gray-600 hover:bg-gray-50">Cancel</button>
          </div>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-gray-50">
            <tr>
              {[
                { label: 'Type',     hide: true },
                { label: 'Symbol',   hide: false },
                { label: 'Dir',      hide: false },
                { label: 'Entry',    hide: true },
                { label: 'Exit',     hide: true },
                { label: 'Qty',      hide: true },
                { label: 'Duration', hide: true },
                { label: 'P&L',      hide: false },
                { label: 'Status',   hide: false },
                { label: '',         hide: true },
                { label: '',         hide: false },
              ].map((col, i) => (
                <th key={i} className={`px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider ${col.hide ? 'hidden sm:table-cell' : ''}`}>{col.label}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {day.rows.map((row) => {
              // Only needs_review trades need user action — off_plan trades
              // were auto-resolved (no plan candidates existed).
              const needsAction = row.status === 'needs_review';
              const isExpanded = expandedRows.has(row.id);
              const execs = getExecs(row);
              const isFX = row.assetCategory === 'FXCFD' || row.assetCategory === 'CASH';
              const rowPnl = isFX ? row.pnl : row.nativePnl;
              const rowPnlCurrency = isFX ? baseCurrency : row.currency;

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
                    <td className="hidden sm:table-cell px-4 py-3.5 text-sm text-gray-900">
                      {fmtPrice(row.entry, row.currency)}
                    </td>
                    <td className="hidden sm:table-cell px-4 py-3.5 text-sm text-gray-900">
                      {row.tradeStatus === 'open' ? '—' : fmtPrice(row.exit, row.currency)}
                    </td>
                    <td className="hidden sm:table-cell px-4 py-3.5 text-sm text-gray-900"><PrivacyValue value={row.qty != null ? Number(row.qty).toLocaleString() : '—'} /></td>
                    <td className="hidden sm:table-cell px-4 py-3.5 text-sm text-gray-500">{row.duration}</td>
                    <td className={`px-4 py-3.5 text-sm font-medium ${(rowPnl || 0) >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                      {row.tradeStatus === 'open' ? '—' : <PrivacyValue value={fmtPnl(rowPnl, rowPnlCurrency, 0)} />}
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
                      {row.tradeStatus === 'closed' && (
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

                  {isExpanded && (() => {
                    // If row.qty (total opening quantity on the logical trade)
                    // is larger than what we see from in-window SELL/BUY opens,
                    // the delta is pre-window -- show it as a synthetic row so
                    // the user understands where the missing shares came from.
                    const openQty = execs
                      .filter(e => (e.open_close_indicator || '').includes('O'))
                      .reduce((s, e) => s + Math.abs(parseFloat(e.quantity) || 0), 0);
                    const orphanQty = Math.max(0, (row.qty || 0) - openQty);
                    const orphanSide = row.direction === 'LONG' ? 'BUY'
                                     : row.direction === 'SHORT' ? 'SELL'
                                     : null;
                    return <ExecSubTable execs={execs} orphanQty={orphanQty} orphanSide={orphanSide} />;
                  })()}

                  {needsAction && openResolve === row.id && (
                    <tr className="bg-amber-50">
                      <td colSpan={COL_SPAN} className="px-6 py-3">
                        <div className="bg-white rounded-xl p-4 border border-purple-200">
                          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
                            Resolve {fmtSymbol({ symbol: row.symbol, asset_category: row.assetCategory })} &middot; <PrivacyValue value={fmtPnl(rowPnl, rowPnlCurrency, 0)} />
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

      {!note && (
        <div className="px-6 py-5 border-t border-gray-100 bg-gray-50">
          <div className="flex items-center space-x-2 mb-3">
            <svg className="w-4 h-4 text-blue-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
            </svg>
            <p className="text-sm font-semibold text-gray-700">How was your day?</p>
          </div>
          <textarea
            value={journalInput}
            onChange={e => setJournalInput(e.target.value)}
            placeholder="What went well? What did you miss? Any patterns you noticed today..."
            rows={3}
            className="w-full text-sm border border-gray-200 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white resize-none"
          />
          <div className="flex items-center justify-between mt-3">
            <p className="text-xs text-gray-400">This becomes your session log -- visible in Daily View and Journal.</p>
            <button onClick={handleSaveJournal} className="bg-blue-600 text-white text-xs font-medium px-4 py-2 rounded-lg hover:bg-blue-700">Save journal</button>
          </div>
        </div>
      )}

      {shareRow && (
        <ShareModal
          row={shareRow}
          plannedStop={plannedTradesMap[shareRow.plannedTradeId]?.planned_stop_loss ?? null}
          baseCurrency={baseCurrency}
          onClose={() => setShareRow(null)}
        />
      )}
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
  const bump = useBumpDataVersion();
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
            // Include a trade if it was opened OR closed within the window.
            // Matters for (a) trades that opened months ago but closed in-window
            // and (b) orphan trades with opened_at=null (pre-window opens).
            .or(`opened_at.gte.${isoDate},closed_at.gte.${isoDate}`)
            .order('opened_at', { ascending: false, nullsFirst: false }),
          supabase
            .from('trades')
            .select('ib_exec_id, ib_order_id, conid, symbol, trade_price, quantity, buy_sell, open_close_indicator, date_time, ib_commission, ib_commission_currency, currency')
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

  const handleResolve = async (tradeId, newStatus) => {
    // .eq('user_id') on the update so RLS + service-side filter both agree.
    // The previous version fired-and-forgot without checking for errors;
    // that meant a failed update would silently leave the UI optimistically
    // updated while the row on the server was unchanged.
    const { error } = await supabase
      .from('logical_trades')
      .update({ matching_status: newStatus })
      .eq('id', tradeId)
      .eq('user_id', userId);
    if (error) {
      console.error('[daily] resolve failed:', error.message);
      Sentry.withScope((scope) => {
        scope.setTag('screen', 'daily');
        scope.setTag('step', 'resolve-trade');
        Sentry.captureException(error);
      });
      alert(`Could not update trade: ${error.message}`);
      return;
    }
    setTrades(prev => prev.map(t => t.id === tradeId ? { ...t, matching_status: newStatus } : t));
    // Bump trades so Home pipeline count, Journal filters, Performance
    // stats, and Review queue all silently refresh next time they're shown.
    bump('trades');
  };

  const { exitMap, openOrderIds } = useMemo(() => buildExitInfo(trades, rawTrades), [trades, rawTrades]);

  // Pre-parse all raw trade timestamps once; passed to DayBlock for exec drill-down
  const rawTradesWithIso = useMemo(() =>
    rawTrades.map(t => ({ ...t, _ms: parseTradeTime(t.date_time) })),
    [rawTrades]
  );

  const days = useMemo(() => {
    const assetMatch = (cat) => {
      if (cat === 'STK') return assetFilters.STK;
      if (cat === 'OPT') return assetFilters.OPT;
      if (cat === 'FXCFD' || cat === 'CASH') return assetFilters.FX;
      return true;
    };
    const filtered = trades.filter(t =>
      (!search || t.symbol?.toLowerCase().includes(search.toLowerCase())) &&
      assetMatch(t.asset_category)
    );


    const grouped = new Map();
    for (const t of filtered) {
      const anchor = (t.status === 'closed' ? t.closed_at : t.opened_at) || t.opened_at;
      if (!anchor) continue;
      const dateKey = anchor.slice(0, 10);
      if (!grouped.has(dateKey)) grouped.set(dateKey, []);
      grouped.get(dateKey).push(t);
    }

    let result = Array.from(grouped.entries()).map(([dateKey, dayTrades]) => {
      const closed = dayTrades.filter(t => t.status === 'closed');
      const wins = closed.filter(t => pnlBase(t) > 0).length;
      const losses = closed.filter(t => pnlBase(t) <= 0).length;
      const totalPnl = closed.reduce((sum, t) => sum + pnlBase(t), 0);
      const needsReview = dayTrades.filter(t => t.matching_status === 'needs_review').length;

      const rows = dayTrades.map(t => {
        const { entry, exit, isOrphan } = getDisplayPrices(t, exitMap, openOrderIds);
        return {
          id: t.id,
          conid: t.conid,
          openedAt: t.opened_at,
          closedAt: t.closed_at,
          assetCategory: t.asset_category,
          currency: t.currency,
          symbol: t.symbol,
          direction: t.direction,
          entry,
          exit,
          isOrphan,
          qty: t.total_opening_quantity,
          closingQty: t.total_closing_quantity,
          nativePnl: t.total_realized_pnl,
          duration: calcDuration(t.opened_at, t.closed_at),
          pnl: pnlBase(t),
          status: t.matching_status || 'needs_review',
          tradeStatus: t.status,
          plannedTradeId: t.planned_trade_id || null,
          sourceNotes: t.source_notes || null,
        };
      });

      return { dateKey, dateLabel: fmtDateLabel(dateKey), rows, trades: dayTrades.length, wins, losses, pnl: totalPnl, needsReview, note: dailyNotes[dateKey] || null };
    });

    result = result.filter(d => dateFilter === 'all' || d.dateKey === dateFilter);
    result.sort((a, b) => sortAsc
      ? a.dateKey.localeCompare(b.dateKey)
      : b.dateKey.localeCompare(a.dateKey)
    );

    return result;
  }, [trades, search, dateFilter, sortAsc, exitMap, openOrderIds, dailyNotes, assetFilters]);

  const uniqueDates = useMemo(() =>
    [...new Set(trades.map(t => {
      const anchor = (t.status === 'closed' ? t.closed_at : t.opened_at) || t.opened_at;
      return anchor?.slice(0, 10);
    }).filter(Boolean))].sort().reverse(),
    [trades]
  );

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
              { key: 'STK', label: 'S',  wrap: 'w-8 justify-center', onCls: 'bg-gray-100 text-gray-600 border-gray-200', offCls: 'bg-white text-gray-300 border-gray-200' },
              { key: 'FX',  label: 'FX', wrap: 'px-2',                onCls: 'bg-blue-100 text-blue-700 border-blue-200', offCls: 'bg-white text-gray-300 border-gray-200' },
              { key: 'OPT', label: 'O',  wrap: 'w-8 justify-center', onCls: 'bg-purple-100 text-purple-700 border-purple-200', offCls: 'bg-white text-gray-300 border-gray-200' },
            ].map(({ key, label, wrap, onCls, offCls }) => {
              const active = assetFilters[key];
              return (
                <button
                  key={key}
                  onClick={() => setAssetFilters(f => ({ ...f, [key]: !f[key] }))}
                  aria-pressed={active}
                  title={active ? `Hide ${label === 'S' ? 'stocks' : label === 'FX' ? 'FX' : 'options'}` : `Show ${label === 'S' ? 'stocks' : label === 'FX' ? 'FX' : 'options'}`}
                  className={`inline-flex items-center ${wrap} h-8 rounded text-xs font-bold border transition-colors ${active ? onCls : offCls}`}
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
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 px-5 py-16 text-center">
          <p className="text-sm font-medium text-gray-500 mb-1">No trades found</p>
          <p className="text-xs text-gray-400">Sync your IBKR account to import trades</p>
        </div>
      ) : (
        <>
          {days.map(day => (
            <DayBlock key={day.dateKey} day={day} rawTradesWithIso={rawTradesWithIso} onResolve={handleResolve} plannedTradesMap={plannedTradesMap} baseCurrency={baseCurrency} userId={session.user.id} onReviewOpen={onReviewOpen} />
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

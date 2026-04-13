import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../lib/supabaseClient';
import { pnlBase, currencySymbol, fmtPrice, fmtPnl } from '../lib/formatters';
import PrivacyValue from '../components/PrivacyValue';
import { usePrivacy } from '../lib/PrivacyContext';
import ShareModal from '../components/ShareModal';

const statusStyles = {
  matched: 'bg-blue-50 text-blue-600',
  unmatched: 'bg-amber-100 text-amber-700',
  ambiguous: 'bg-purple-50 text-purple-700',
  auto: 'bg-gray-100 text-gray-500',
  manual: 'bg-green-50 text-green-700',
};

const fmtTime = (iso) => {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
};

const fmtDateLabel = (dateKey) => {
  return new Date(dateKey + 'T12:00:00Z').toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  });
};

// Convert IBKR "20260408;100300" → ISO "2026-04-08T10:03:00Z"
const parseIBKRDate = (dt) => {
  if (!dt) return null;
  const [date, time] = dt.split(';');
  if (!date) return null;
  const d = `${date.slice(0,4)}-${date.slice(4,6)}-${date.slice(6,8)}`;
  const t = time ? `${time.slice(0,2)}:${time.slice(2,4)}:${time.slice(4,6)}` : '00:00:00';
  return `${d}T${t}Z`;
};

const calcDuration = (openedAt, closedAt) => {
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
    .map(t => ({ ...t, _iso: parseIBKRDate(t.date_time) }))
    .filter(t => t._iso);

  const exitMap = {};
  for (const lt of logicalTrades) {
    if (lt.status !== 'closed') continue;
    const opp = lt.direction === 'LONG' ? 'SELL' : 'BUY';
    const start = lt.opened_at || '';
    const end   = lt.closed_at || '';
    const matches = closing.filter(t =>
      t.symbol === lt.symbol &&
      t.buy_sell === opp &&
      t._iso >= start &&
      t._iso <= end
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

const COL_SPAN = 12; // TYPE TIME SYMBOL DIR ENTRY EXIT QTY DURATION P&L STATUS share chevron

function ExecSubTable({ execs }) {
  if (!execs || execs.length === 0) {
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
                {['Time', 'Exec Price', 'Qty', 'Type', 'Indicator', 'Commission', 'Exec ID'].map(h => (
                  <th key={h} className="pb-1.5 text-left text-xs font-medium text-gray-400 uppercase tracking-wide pr-4">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {execs.map((ex, i) => {
                const iso = ex._iso;
                const time = iso ? new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—';
                const commission = parseFloat(ex.ib_commission);
                const execIdShort = ex.ib_exec_id ? '…' + ex.ib_exec_id.slice(-10) : '—';
                return (
                  <tr key={i} className="border-t border-gray-100 first:border-0">
                    <td className="py-1.5 pr-4 text-xs text-gray-600">{time}</td>
                    <td className="py-1.5 pr-4 text-xs text-gray-800 font-medium"><PrivacyValue value={fmtPrice(parseFloat(ex.trade_price), ex.currency)} /></td>
                    <td className="py-1.5 pr-4 text-xs text-gray-600"><PrivacyValue value={Math.abs(parseFloat(ex.quantity) || 0)} /></td>
                    <td className="py-1.5 pr-4">
                      <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${ex.buy_sell === 'BUY' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'}`}>
                        {ex.buy_sell}
                      </span>
                    </td>
                    <td className="py-1.5 pr-4 text-xs text-gray-500">{ex.open_close_indicator || '—'}</td>
                    <td className="py-1.5 pr-4 text-xs text-gray-500">
                      <PrivacyValue value={!isNaN(commission) ? fmtPnl(commission, ex.currency, 0) : '—'} />
                    </td>
                    <td className="py-1.5 text-xs text-gray-400 font-mono">{execIdShort}</td>
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


function DayBlock({ day, rawTradesWithIso, onResolve, plannedTradesMap = {}, baseCurrency = 'USD', userId }) {
  const [note, setNote] = useState(day.note);
  const [editingNote, setEditingNote] = useState(false);
  const [noteInput, setNoteInput] = useState(day.note || '');
  const [journalInput, setJournalInput] = useState('');
  const [openResolve, setOpenResolve] = useState(null);
  const [expandedRows, setExpandedRows] = useState(new Set());
  const [shareRow, setShareRow] = useState(null);

  const toggleExpand = (id) => {
    setExpandedRows(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const persistNote = async (text) => {
    await supabase.from('daily_notes').upsert(
      { user_id: userId, date_key: day.dateKey, note: text, updated_at: new Date().toISOString() },
      { onConflict: 'user_id,date_key' }
    );
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
    const start = openedAt || '';
    const end = closedAt || new Date().toISOString();
    return rawTradesWithIso.filter(t =>
      t.conid === conid &&
      t._iso &&
      t._iso >= start &&
      t._iso <= end
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
              <span className="text-amber-600 font-medium"> &middot; {day.needsReview} need review</span>
            )}
          </p>
        </div>
        <div className="text-right">
          <p className={`text-2xl font-bold ${day.pnl >= 0 ? 'text-green-600' : 'text-red-500'}`}>
            <PrivacyValue value={fmtPnl(day.pnl, baseCurrency, 0)} />
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
              {['Type', 'Time', 'Symbol', 'Dir', 'Entry', 'Exit', 'Qty', 'Duration', 'P&L', 'Status', '', ''].map((h, i) => (
                <th key={i} className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {day.rows.map((row) => {
              const needsAction = row.status === 'unmatched' || row.status === 'ambiguous';
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
                    <td className="px-4 py-3.5">
                      <AssetBadge category={row.assetCategory} />
                    </td>
                    <td className="px-4 py-3.5 text-sm text-gray-600">{row.time}</td>
                    <td className="px-4 py-3.5 text-sm font-medium text-gray-900">{row.symbol}</td>
                    <td className="px-4 py-3.5 text-sm text-gray-600">{row.direction}</td>
                    <td className="px-4 py-3.5 text-sm text-gray-900">
                      {row.isOrphan ? <span className="text-gray-400">N/A</span> : <PrivacyValue value={fmtPrice(row.entry, row.currency)} />}
                    </td>
                    <td className="px-4 py-3.5 text-sm text-gray-900">
                      {row.tradeStatus === 'open' ? '—' : <PrivacyValue value={fmtPrice(row.exit, row.currency)} />}
                    </td>
                    <td className="px-4 py-3.5 text-sm text-gray-900"><PrivacyValue value={row.qty} /></td>
                    <td className="px-4 py-3.5 text-sm text-gray-500">{row.duration}</td>
                    <td className={`px-4 py-3.5 text-sm font-medium ${(rowPnl || 0) >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                      {row.tradeStatus === 'open' ? '—' : <PrivacyValue value={fmtPnl(rowPnl, rowPnlCurrency, 0)} />}
                    </td>
                    <td className="px-4 py-3.5" onClick={e => e.stopPropagation()}>
                      <div className="flex items-center space-x-2">
                        <span className={`px-2 py-0.5 text-xs rounded-full font-medium ${statusStyles[row.status] || 'bg-gray-100 text-gray-500'}`}>
                          {row.status.charAt(0).toUpperCase() + row.status.slice(1)}
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
                    <td className="px-2 py-3.5" onClick={e => e.stopPropagation()}>
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

                  {isExpanded && <ExecSubTable execs={execs} />}

                  {needsAction && openResolve === row.id && (
                    <tr className="bg-amber-50">
                      <td colSpan={COL_SPAN} className="px-6 py-3">
                        <div className={`bg-white rounded-xl p-4 border ${row.status === 'ambiguous' ? 'border-purple-200' : 'border-amber-200'}`}>
                          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
                            Resolve {row.symbol} &middot; <PrivacyValue value={fmtPnl(rowPnl, rowPnlCurrency, 0)} />
                          </p>
                          <p className="text-sm text-gray-500 mb-3">
                            {row.status === 'unmatched'
                              ? 'No plan was matched to this trade. Mark it as unplanned or link a plan manually.'
                              : 'Multiple plans matched. Go to the Journal to resolve this trade.'}
                          </p>
                          <div className="flex space-x-2">
                            {row.status === 'unmatched' && (
                              <button
                                onClick={() => { onResolve(row.id, 'manual'); setOpenResolve(null); }}
                                className="bg-blue-600 text-white text-xs font-medium px-4 py-2 rounded-lg hover:bg-blue-700"
                              >
                                Mark as unplanned
                              </button>
                            )}
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

export default function DailyViewScreen({ session }) {
  const [trades, setTrades] = useState([]);
  const [rawTrades, setRawTrades] = useState([]);
  const [plannedTradesMap, setPlannedTradesMap] = useState({});
  const [baseCurrency, setBaseCurrency] = useState('USD');
  const [dailyNotes, setDailyNotes] = useState({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [dateFilter, setDateFilter] = useState('all');
  const [sortAsc, setSortAsc] = useState(false);

  useEffect(() => {
    if (!session?.user?.id) return;
    fetchTrades();
  }, [session]);

  const fetchTrades = async () => {
    const userId = session.user.id;
    const [logicalRes, rawRes, credRes, plansRes, notesRes] = await Promise.all([
      supabase
        .from('logical_trades')
        .select('*')
        .eq('user_id', userId)
        .order('opened_at', { ascending: false }),
      supabase
        .from('trades')
        .select('ib_exec_id, ib_order_id, conid, symbol, trade_price, quantity, buy_sell, open_close_indicator, date_time, ib_commission, currency')
        .eq('user_id', userId),
      supabase
        .from('user_ibkr_credentials')
        .select('base_currency')
        .eq('user_id', userId)
        .single(),
      supabase
        .from('planned_trades')
        .select('id, planned_stop_loss')
        .eq('user_id', userId),
      supabase
        .from('daily_notes')
        .select('date_key, note')
        .eq('user_id', userId),
    ]);
    setTrades(logicalRes.data || []);
    setRawTrades(rawRes.data || []);
    if (credRes.data?.base_currency) setBaseCurrency(credRes.data.base_currency);
    const map = {};
    for (const p of (plansRes.data || [])) map[p.id] = p;
    setPlannedTradesMap(map);
    const notesMap = {};
    for (const n of (notesRes.data || [])) notesMap[n.date_key] = n.note;
    setDailyNotes(notesMap);
    setLoading(false);
  };

  const handleResolve = async (tradeId, newStatus) => {
    await supabase
      .from('logical_trades')
      .update({ matching_status: newStatus })
      .eq('id', tradeId);
    setTrades(prev => prev.map(t => t.id === tradeId ? { ...t, matching_status: newStatus } : t));
  };

  const { exitMap, openOrderIds } = useMemo(() => buildExitInfo(trades, rawTrades), [trades, rawTrades]);

  // Pre-parse all raw trade timestamps once; passed to DayBlock for exec drill-down
  const rawTradesWithIso = useMemo(() =>
    rawTrades.map(t => ({ ...t, _iso: parseIBKRDate(t.date_time) })),
    [rawTrades]
  );

  const days = useMemo(() => {
    const filtered = trades.filter(t =>
      !search || t.symbol?.toLowerCase().includes(search.toLowerCase())
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
      const needsReview = dayTrades.filter(
        t => t.matching_status === 'unmatched' || t.matching_status === 'ambiguous'
      ).length;

      const rows = dayTrades.map(t => {
        const { entry, exit, isOrphan } = getDisplayPrices(t, exitMap, openOrderIds);
        return {
          id: t.id,
          conid: t.conid,
          openedAt: t.opened_at,
          closedAt: t.closed_at,
          assetCategory: t.asset_category,
          currency: t.currency,
          time: fmtTime(t.opened_at),
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
          status: t.matching_status || 'auto',
          tradeStatus: t.status,
          plannedTradeId: t.planned_trade_id || null,
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
  }, [trades, search, dateFilter, sortAsc, exitMap, openOrderIds, dailyNotes]);

  const uniqueDates = useMemo(() =>
    [...new Set(trades.map(t => {
      const anchor = (t.status === 'closed' ? t.closed_at : t.opened_at) || t.opened_at;
      return anchor?.slice(0, 10);
    }).filter(Boolean))].sort().reverse(),
    [trades]
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-5 h-5 border-2 border-gray-200 border-t-blue-600 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div>
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
          <div />
          <button
            onClick={() => setSortAsc(v => !v)}
            className="flex items-center justify-center space-x-2 px-3 py-2 border border-gray-200 rounded-lg text-sm text-gray-700 bg-gray-50 hover:bg-gray-100"
          >
            <svg className={`w-4 h-4 transition-transform ${sortAsc ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
            <span>{sortAsc ? 'Ascending' : 'Descending'}</span>
          </button>
        </div>
      </div>

      {days.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 px-5 py-16 text-center">
          <p className="text-sm font-medium text-gray-500 mb-1">No trades found</p>
          <p className="text-xs text-gray-400">Sync your IBKR account to import trades</p>
        </div>
      ) : (
        days.map(day => (
          <DayBlock key={day.dateKey} day={day} rawTradesWithIso={rawTradesWithIso} onResolve={handleResolve} plannedTradesMap={plannedTradesMap} baseCurrency={baseCurrency} userId={session.user.id} />
        ))
      )}
    </div>
  );
}

import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabaseClient';
import { currencySymbol, fmtPrice, fmtPnl, fmtDate, pnlBase } from '../lib/formatters';
import { usePrivacy } from '../lib/PrivacyContext';

function calcDuration(opened, closed) {
  if (!opened || !closed) return null;
  const mins = Math.round((new Date(closed) - new Date(opened)) / 60000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

const strategies = [
  { group: 'Timeframe', options: ['Day Trade', 'Swing', 'Position'] },
  { group: 'Setup', options: ['Breakout', 'Support', 'Resistance', 'Momentum'] },
  { group: 'Thesis-driven', options: ['Value', 'Fundamental', 'Macro', 'Catalyst'] },
];

export default function PlanSheet({ session, isOpen, onClose, onSaved, plan }) {
  const isEdit = !!plan?.id;
  const { isPrivate } = usePrivacy();

  const [direction, setDirection] = useState('long');
  const [symbol, setSymbol] = useState('');
  const [assetCategory, setAssetCategory] = useState('STK');
  const [strategy, setStrategy] = useState('');
  const [entry, setEntry] = useState('');
  const [target, setTarget] = useState('');
  const [stop, setStop] = useState('');
  const [qty, setQty] = useState('');
  const [thesis, setThesis] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [baseCurrency, setBaseCurrency] = useState('USD');

  const [debouncedSymbol, setDebouncedSymbol] = useState('');
  const [histTrades, setHistTrades] = useState([]);
  const [histExpanded, setHistExpanded] = useState(false);

  const resetForm = useCallback(() => {
    setSymbol(''); setStrategy(''); setDirection('long'); setAssetCategory('STK');
    setEntry(''); setTarget(''); setStop(''); setQty(''); setThesis('');
    setError(null); setSaved(false); setConfirmDelete(false);
    setDebouncedSymbol(''); setHistTrades([]); setHistExpanded(false);
  }, []);

  const handleClose = useCallback(() => { resetForm(); onClose(); }, [resetForm, onClose]);

  // Fetch base currency when sheet opens
  useEffect(() => {
    if (!isOpen || !session?.user?.id) return;
    supabase
      .from('user_ibkr_credentials')
      .select('base_currency')
      .eq('user_id', session.user.id)
      .single()
      .then(({ data }) => { if (data?.base_currency) setBaseCurrency(data.base_currency); });
  }, [isOpen, session?.user?.id]);

  // Populate form when sheet opens
  useEffect(() => {
    if (!isOpen) return;
    if (plan) {
      setDirection((plan.direction || 'LONG').toLowerCase());
      setSymbol(plan.symbol || '');
      setAssetCategory(plan.asset_category || 'STK');
      setStrategy(plan.strategy || '');
      setEntry(plan.planned_entry_price != null ? String(plan.planned_entry_price) : '');
      setTarget(plan.planned_target_price != null ? String(plan.planned_target_price) : '');
      setStop(plan.planned_stop_loss != null ? String(plan.planned_stop_loss) : '');
      setQty(plan.planned_quantity != null ? String(plan.planned_quantity) : '');
      setThesis(plan.thesis ?? plan.notes ?? '');
    } else {
      resetForm();
    }
    setError(null);
    setSaved(false);
    setConfirmDelete(false);
  }, [isOpen, plan, resetForm]);

  const e = parseFloat(entry) || 0;
  const t = parseFloat(target) || 0;
  const s = parseFloat(stop) || 0;
  const q = parseFloat(qty) || 0;

  const cs = currencySymbol(baseCurrency);
  const posSize = e && q ? `${cs}${(e * q).toLocaleString('en-US', { maximumFractionDigits: 0 })}` : '--';
  const risk = e && s && q ? `${cs}${(Math.abs(e - s) * q).toLocaleString('en-US', { maximumFractionDigits: 0 })}` : '--';
  const reward = e && t && q ? `${cs}${(Math.abs(t - e) * q).toLocaleString('en-US', { maximumFractionDigits: 0 })}` : '--';
  const rr = e && s && t ? (Math.abs(t - e) / Math.abs(e - s)).toFixed(2) + 'R' : '--';
  const rrColor = e && s && t
    ? parseFloat(rr) >= 2 ? 'text-green-600' : parseFloat(rr) >= 1 ? 'text-amber-500' : 'text-red-500'
    : 'text-gray-700';

  const showCalc = e > 0 && q > 0;

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (ev) => { if (ev.key === 'Escape') handleClose(); };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, handleClose]);

  // Debounce ticker input for hist trade lookup
  useEffect(() => {
    const id = setTimeout(() => setDebouncedSymbol(symbol.trim().toUpperCase()), 500);
    return () => clearTimeout(id);
  }, [symbol]);

  // Fetch historical closed trades for this ticker
  useEffect(() => {
    const uid = session?.user?.id;
    if (!debouncedSymbol || !uid) { setHistTrades([]); return; }
    supabase
      .from('logical_trades')
      .select('id, direction, opened_at, closed_at, avg_entry_price, total_closing_quantity, total_opening_quantity, total_realized_pnl, fx_rate_to_base, currency')
      .eq('user_id', uid)
      .eq('symbol', debouncedSymbol)
      .eq('status', 'closed')
      .order('closed_at', { ascending: false })
      .then(({ data }) => setHistTrades(data || []));
  }, [debouncedSymbol, session?.user?.id]);

  const handleSave = async () => {
    if (!session?.user?.id) {
      setError('Not logged in. Please refresh and try again.');
      return;
    }
    if (!symbol.trim()) { setError('Ticker is required.'); return; }
    if (!e) { setError('Entry price is required.'); return; }

    setError(null);
    setSaving(true);

    const payload = {
      user_id:               session.user.id,
      symbol:                symbol.trim().toUpperCase(),
      direction:             direction.toUpperCase(),
      asset_category:        assetCategory,
      planned_entry_price:   e || null,
      planned_target_price:  t || null,
      planned_stop_loss:     s || null,
      planned_quantity:      q || null,
      strategy:              strategy || null,
      thesis:                thesis.trim() || null,
    };

    let dbError;
    if (isEdit) {
      ({ error: dbError } = await supabase
        .from('planned_trades')
        .update(payload)
        .eq('id', plan.id)
        .eq('user_id', session.user.id));
    } else {
      ({ error: dbError } = await supabase
        .from('planned_trades')
        .insert(payload));
    }

    setSaving(false);
    if (dbError) {
      setError(`Save failed: ${dbError.message} (code: ${dbError.code})`);
      return;
    }
    setSaved(true);
    setTimeout(() => { handleClose(); onSaved?.(); }, 1200);
  };

  const handleDelete = async () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setDeleting(true);
    const { error: dbError } = await supabase
      .from('planned_trades')
      .delete()
      .eq('id', plan.id)
      .eq('user_id', session.user.id);
    setDeleting(false);
    if (dbError) {
      setError(`Delete failed: ${dbError.message}`);
      setConfirmDelete(false);
      return;
    }
    handleClose();
    onSaved?.();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={handleClose} />

      <div className="relative z-10 w-full max-w-lg bg-white rounded-2xl shadow-xl max-h-[90vh] overflow-y-auto">
        <div className="px-6 pt-6 pb-8">
          <div className="flex items-center justify-between mb-5">
            <h3 className="text-lg font-semibold text-gray-900">
              {isEdit ? 'Edit plan' : 'New plan'}
            </h3>
            <button onClick={handleClose} className="text-gray-400 hover:text-gray-600 p-1 -mr-1">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {saved ? (
            <div className="flex flex-col items-center py-10 space-y-3">
              <div className="w-12 h-12 bg-green-50 rounded-full flex items-center justify-center">
                <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <p className="text-sm font-semibold text-gray-900">
                {isEdit ? 'Plan updated' : 'Plan saved'}
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1.5">
                  Ticker <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  placeholder="AAPL, ES, EUR/USD..."
                  value={symbol}
                  onChange={ev => setSymbol(ev.target.value)}
                  className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-400 bg-gray-50 uppercase"
                />

                {histTrades.length > 0 && (() => {
                  const wins = histTrades.filter(t => pnlBase(t) > 0).length;
                  const losses = histTrades.length - wins;
                  const totalPnl = histTrades.reduce((sum, t) => sum + pnlBase(t), 0);
                  const totalQty = histTrades.reduce((sum, t) => sum + (t.total_closing_quantity || t.total_opening_quantity || 0), 0);
                  const weightedEntry = histTrades.reduce((sum, t) => {
                    const q = t.total_closing_quantity || t.total_opening_quantity || 0;
                    return sum + (t.avg_entry_price || 0) * q;
                  }, 0);
                  const avgEntry = totalQty > 0 ? weightedEntry / totalQty : null;
                  const tradeCurrency = histTrades[0]?.currency || baseCurrency;

                  return (
                    <div className="mt-2">
                      <button
                        type="button"
                        onClick={() => setHistExpanded(x => !x)}
                        className="w-full text-left"
                      >
                        <p className="text-xs text-gray-400 leading-relaxed">
                          <span className="text-gray-500 font-medium">{histTrades.length} trade{histTrades.length !== 1 ? 's' : ''}</span>
                          {' · '}
                          <span className="text-green-600">{wins}W</span>
                          {' / '}
                          <span className="text-red-500">{losses}L</span>
                          {avgEntry != null && <> · avg entry {fmtPrice(avgEntry, tradeCurrency)}</>}
                          {' · '}
                          {isPrivate
                            ? <span className="tracking-widest">••••</span>
                            : <span className={totalPnl >= 0 ? 'text-green-600' : 'text-red-500'}>{fmtPnl(totalPnl, baseCurrency, 0)}</span>
                          }
                        </p>
                      </button>

                      {histExpanded && (
                        <div className="mt-2 border border-gray-100 rounded-xl overflow-hidden">
                          {histTrades.map(t => {
                            const q = t.total_closing_quantity || t.total_opening_quantity || 0;
                            const isLong = t.direction === 'LONG';
                            const tPnl = pnlBase(t);
                            const exit = (t.avg_entry_price != null && q > 0 && t.total_realized_pnl != null)
                              ? (isLong ? t.avg_entry_price + t.total_realized_pnl / q : t.avg_entry_price - t.total_realized_pnl / q)
                              : null;
                            const dur = calcDuration(t.opened_at, t.closed_at);
                            const tCurrency = t.currency || baseCurrency;
                            return (
                              <div key={t.id} className="flex items-center gap-2 px-3 py-2 text-xs border-b border-gray-50 last:border-0 bg-white">
                                <span className="text-gray-400 w-12 shrink-0">{fmtDate(t.closed_at)}</span>
                                <span className={`px-1.5 py-0.5 rounded font-medium shrink-0 ${isLong ? 'bg-blue-50 text-blue-600' : 'bg-red-50 text-red-500'}`}>
                                  {t.direction}
                                </span>
                                <span className="text-gray-600">{fmtPrice(t.avg_entry_price, tCurrency)}</span>
                                <span className="text-gray-300">→</span>
                                <span className="text-gray-600">{exit != null ? fmtPrice(exit, tCurrency) : 'N/A'}</span>
                                <span className={`font-medium ml-auto shrink-0 ${tPnl >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                                  {isPrivate ? '••••' : fmtPnl(tPnl, baseCurrency, 0)}
                                </span>
                                {dur && <span className="text-gray-400 shrink-0">{dur}</span>}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1.5">
                  Strategy
                </label>
                <select
                  value={strategy}
                  onChange={ev => setStrategy(ev.target.value)}
                  className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-gray-50 text-gray-700"
                >
                  <option value="">Select a strategy...</option>
                  {strategies.map(group => (
                    <optgroup key={group.group} label={group.group}>
                      {group.options.map(opt => (
                        <option key={opt}>{opt}</option>
                      ))}
                    </optgroup>
                  ))}
                  <option value="other">Other (custom)...</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1.5">
                  Direction <span className="text-red-400">*</span>
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => setDirection('long')}
                    className={`py-3 rounded-xl text-sm font-semibold border transition-colors ${
                      direction === 'long'
                        ? 'border-transparent bg-green-50 text-green-700 border-green-300'
                        : 'border-gray-200 bg-white text-gray-400'
                    }`}
                  >
                    &#9650; Long
                  </button>
                  <button
                    onClick={() => setDirection('short')}
                    className={`py-3 rounded-xl text-sm font-semibold border transition-colors ${
                      direction === 'short'
                        ? 'border-transparent bg-red-50 text-red-600 border-red-300'
                        : 'border-gray-200 bg-white text-gray-400'
                    }`}
                  >
                    &#9660; Short
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1.5">
                  Entry price <span className="text-red-400">*</span>
                </label>
                <input
                  type="number"
                  placeholder="0.00"
                  value={entry}
                  onChange={ev => setEntry(ev.target.value)}
                  className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-gray-50"
                />
              </div>

              <div className="border-t border-gray-100 pt-4">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Optional</p>
                <div className="grid grid-cols-3 gap-2 mb-3">
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Target</label>
                    <input type="number" placeholder="0.00" value={target} onChange={ev => setTarget(ev.target.value)}
                      className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-gray-50" />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Stop loss</label>
                    <input type="number" placeholder="0.00" value={stop} onChange={ev => setStop(ev.target.value)}
                      className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-gray-50" />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Quantity</label>
                    <input type="number" placeholder="0" value={qty} onChange={ev => setQty(ev.target.value)}
                      className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-gray-50" />
                  </div>
                </div>

                {showCalc && (
                  <div className="grid grid-cols-4 gap-2 bg-gray-50 rounded-xl p-3 border border-gray-100 mb-3">
                    <div className="text-center"><p className="text-xs text-gray-400 mb-1">Position</p><p className="text-sm font-semibold text-gray-700">{posSize}</p></div>
                    <div className="text-center"><p className="text-xs text-gray-400 mb-1">Risk</p><p className="text-sm font-semibold text-red-500">{risk}</p></div>
                    <div className="text-center"><p className="text-xs text-gray-400 mb-1">Reward</p><p className="text-sm font-semibold text-green-600">{reward}</p></div>
                    <div className="text-center"><p className="text-xs text-gray-400 mb-1">R:R</p><p className={`text-sm font-semibold ${rrColor}`}>{rr}</p></div>
                  </div>
                )}

                <textarea
                  placeholder="Thesis / notes -- why are you taking this trade?"
                  rows={2}
                  value={thesis}
                  onChange={ev => setThesis(ev.target.value)}
                  className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-gray-50 resize-none"
                />
              </div>

              {error && (
                <div className="bg-red-50 border border-red-100 rounded-xl px-4 py-3 text-sm text-red-600">
                  {error}
                </div>
              )}

              <button
                onClick={handleSave}
                disabled={saving}
                className="w-full bg-blue-600 text-white font-semibold py-3.5 rounded-xl text-sm hover:bg-blue-700 transition-colors disabled:opacity-50"
              >
                {saving ? 'Saving...' : isEdit ? 'Save changes' : 'Save plan'}
              </button>

              {isEdit && (
                <button
                  onClick={handleDelete}
                  disabled={deleting}
                  className={`w-full font-semibold py-3 rounded-xl text-sm transition-colors disabled:opacity-50 ${
                    confirmDelete
                      ? 'bg-red-600 text-white hover:bg-red-700'
                      : 'border border-red-200 text-red-500 hover:bg-red-50'
                  }`}
                >
                  {deleting ? 'Deleting...' : confirmDelete ? 'Tap again to confirm delete' : 'Delete plan'}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

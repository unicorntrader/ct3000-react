import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import * as Sentry from '@sentry/react';
import { supabase } from '../lib/supabaseClient';
import { fmtPnl, fmtPrice, fmtDate, fmtSymbol } from '../lib/formatters';
import { useDataVersion, useInitialLoadTracker, useBumpDataVersion } from '../lib/DataVersionContext';
import LoadError from '../components/LoadError';

// Full-page review workflow — replaces the old ReviewSheet bottom drawer.
// Wired from HomeScreen + DailyViewScreen review banners via <Link to="/review">
// or navigate('/review'). All the wizard logic is identical to the drawer
// version; only the container chrome changed from overlay+slide-up to a
// regular page with a back button.

function TradeCard({ trade }) {
  // Single-trade view: show in the trade's native currency, not base.
  const pnl = trade.total_realized_pnl || 0;
  const currency = trade.currency || 'USD';
  const isClosed = trade.status === 'closed';
  const isWin = pnl > 0;
  const closingQty = trade.total_closing_quantity || trade.total_opening_quantity || 0;
  // Prefer builder-stored avg_exit_price (correct for orphans too). Fall back
  // to reverse-engineering from entry + native P&L for legacy rows that
  // predate the column. Reverse-engineering MUST divide by (qty * multiplier)
  // so options / futures (multiplier 100+) do not come out 100x off.
  const multiplier = parseFloat(trade.multiplier) || 1;
  let exit = trade.avg_exit_price ?? null;
  if (exit == null && isClosed && trade.avg_entry_price != null && closingQty > 0) {
    exit = trade.direction === 'LONG'
      ? trade.avg_entry_price + (pnl / (closingQty * multiplier))
      : trade.avg_entry_price - (pnl / (closingQty * multiplier));
  }
  const dateIso = isClosed ? trade.closed_at : trade.opened_at;

  return (
    <div className="bg-gray-50 rounded-xl p-5 mb-6 border border-gray-100">
      <div className="flex justify-between items-start mb-4">
        <div className="flex items-center flex-wrap gap-2">
          <span className="text-lg font-semibold text-gray-900">{fmtSymbol(trade)}</span>
          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
            trade.direction === 'LONG' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'
          }`}>
            {trade.direction}
          </span>
          {isClosed && (
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
              isWin ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'
            }`}>
              {isWin ? 'win' : 'loss'}
            </span>
          )}
          <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-purple-50 text-purple-700">
            Needs review
          </span>
        </div>
        {dateIso && <span className="text-xs text-gray-400 shrink-0">{fmtDate(dateIso)}</span>}
      </div>
      <div className="grid grid-cols-4 gap-2">
        <div className="bg-white rounded-lg px-2 py-2 text-center border border-gray-100">
          <p className="text-[10px] text-gray-400 leading-none mb-1">Entry</p>
          <p className="text-sm font-semibold text-gray-900">
            {trade.avg_entry_price != null ? fmtPrice(trade.avg_entry_price, currency) : '—'}
          </p>
        </div>
        <div className="bg-white rounded-lg px-2 py-2 text-center border border-gray-100">
          <p className="text-[10px] text-gray-400 leading-none mb-1">Exit</p>
          <p className="text-sm font-semibold text-gray-900">
            {exit != null ? fmtPrice(exit, currency) : '—'}
          </p>
        </div>
        <div className="bg-white rounded-lg px-2 py-2 text-center border border-gray-100">
          <p className="text-[10px] text-gray-400 leading-none mb-1">Qty</p>
          <p className="text-sm font-semibold text-gray-900">
            {trade.total_opening_quantity ?? '—'}
          </p>
        </div>
        <div className="bg-white rounded-lg px-2 py-2 text-center border border-gray-100">
          <p className="text-[10px] text-gray-400 leading-none mb-1">P&amp;L</p>
          <p className={`text-sm font-semibold ${isClosed ? (isWin ? 'text-green-600' : 'text-red-500') : 'text-gray-400'}`}>
            {isClosed ? fmtPnl(pnl, currency) : '—'}
          </p>
        </div>
      </div>
    </div>
  );
}

export default function ReviewScreen({ session }) {
  const navigate = useNavigate();
  const [trades, setTrades] = useState([]);
  const [candidatesMap, setCandidatesMap] = useState({});
  const [step, setStep] = useState(0);
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [saving, setSaving] = useState(false);

  // Cross-screen data invalidation — refetch silently when watched tables
  // are mutated elsewhere. See lib/DataVersionContext for the key map.
  const [tradesV, plansV] = useDataVersion('trades', 'plans');
  const bump = useBumpDataVersion();
  const loadTracker = useInitialLoadTracker(reloadKey);

  const current = trades[step] || null;
  const total = trades.length;
  const done = total > 0 && step >= total;
  const candidates = current ? (candidatesMap[current.id] || []) : [];

  // Auto-select first candidate whenever the trade changes
  useEffect(() => {
    setSelected(candidates.length > 0 ? candidates[0].id : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, current?.id]);

  const loadReviewTrades = useCallback(async () => {
    if (!session?.user?.id) return;
    const isInitial = loadTracker.isInitial;
    if (isInitial) setLoading(true);
    setLoadError(null);
    setStep(0);
    setSelected(null);

    try {
      const reviewRes = await supabase
        .from('logical_trades')
        .select('*')
        .eq('user_id', session.user.id)
        // Only needs_review trades land here (2+ plan candidates — system
        // can't auto-pick). Zero-candidate trades are auto-flipped to
        // 'off_plan' in applyPlanMatching and bypass this queue.
        .eq('matching_status', 'needs_review')
        .order('opened_at', { ascending: false });
      if (reviewRes.error) throw reviewRes.error;

      const tradeList = reviewRes.data || [];
      setTrades(tradeList);

      if (tradeList.length > 0) {
        const plansRes = await supabase
          .from('planned_trades')
          .select('id, symbol, direction, asset_category, planned_entry_price, planned_target_price, planned_stop_loss, planned_quantity, thesis, currency, created_at')
          .eq('user_id', session.user.id);
        if (plansRes.error) throw plansRes.error;

        const plans = plansRes.data || [];
        const map = {};
        for (const t of tradeList) {
          // Only show plans that existed BEFORE the trade was opened. Must match
          // the server-side filter in api/rebuild.js::applyPlanMatching so that
          // the UI's candidate list agrees with what rebuild actually matched.
          map[t.id] = plans.filter(p =>
            p.symbol?.trim().toUpperCase() === t.symbol?.trim().toUpperCase() &&
            p.direction?.trim().toUpperCase() === t.direction?.trim().toUpperCase() &&
            p.asset_category?.trim().toUpperCase() === t.asset_category?.trim().toUpperCase() &&
            p.created_at && t.opened_at &&
            new Date(p.created_at).getTime() <= new Date(t.opened_at).getTime()
          );
        }
        setCandidatesMap(map);
      }
    } catch (err) {
      console.error('[review] load failed:', err?.message || err);
      Sentry.withScope((scope) => {
        scope.setTag('screen', 'review');
        scope.setTag('step', 'load');
        scope.setTag('load_kind', isInitial ? 'initial' : 'silent-refetch');
        Sentry.captureException(err instanceof Error ? err : new Error(String(err)));
      });
      if (isInitial) setLoadError(err?.message || 'Could not load trades to review.');
    } finally {
      if (isInitial) setLoading(false);
      loadTracker.markLoaded();
    }
  }, [session]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { loadReviewTrades(); }, [loadReviewTrades, reloadKey, tradesV, plansV]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleExit = useCallback(() => navigate('/'), [navigate]);

  const handleMatch = useCallback(async () => {
    if (!current || !selected || saving) return;
    setSaving(true);
    const { error } = await supabase
      .from('logical_trades')
      .update({ matching_status: 'matched', planned_trade_id: selected, user_reviewed: true })
      .eq('id', current.id)
      .eq('user_id', session.user.id);
    setSaving(false);
    if (error) {
      console.error('[review] match update failed:', error.message);
      alert(`Could not save match: ${error.message}`);
      return;
    }
    bump('trades');
    setSelected(null);
    setStep(s => s + 1);
  }, [current, selected, saving, session, bump]);

  const handleNoPlan = useCallback(async () => {
    if (!current || saving) return;
    setSaving(true);
    const { error } = await supabase
      .from('logical_trades')
      .update({ matching_status: 'off_plan', planned_trade_id: null, user_reviewed: true })
      .eq('id', current.id)
      .eq('user_id', session.user.id);
    setSaving(false);
    if (error) {
      console.error('[review] no-plan update failed:', error.message);
      alert(`Could not save: ${error.message}`);
      return;
    }
    bump('trades');
    setSelected(null);
    setStep(s => s + 1);
  }, [current, saving, session, bump]);

  const handleSkip = useCallback(() => {
    setSelected(null);
    setStep(s => s + 1);
  }, []);

  // Keyboard shortcuts: Enter=match, N=no plan, Escape=exit
  useEffect(() => {
    if (loading) return;
    const handler = (e) => {
      const isTyping = ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName);
      if (e.key === 'Escape') {
        e.preventDefault();
        handleExit();
      } else if (e.key === 'Enter' && !e.shiftKey && !isTyping) {
        e.preventDefault();
        if (done) handleExit();
        else if (selected) handleMatch();
      } else if ((e.key === 'n' || e.key === 'N') && !isTyping) {
        e.preventDefault();
        if (!done) handleNoPlan();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [loading, selected, done, handleExit, handleMatch, handleNoPlan]);

  return (
    <div className="max-w-2xl mx-auto">
      {/* Back / header */}
      <div className="flex items-center justify-between mb-6">
        <button
          onClick={handleExit}
          className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-gray-800"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back to Home
        </button>
        {!loading && !done && total > 0 && (
          <span className="text-xs text-gray-400">Trade {step + 1} of {total}</span>
        )}
      </div>

      <h2 className="text-xl font-semibold text-gray-900 mb-1">
        {loading ? 'Loading…' : done ? 'Review complete' : total === 0 ? 'Nothing to review' : 'Review trades'}
      </h2>
      <p className="text-sm text-gray-400 mb-6">
        {loading
          ? 'Fetching trades that need review…'
          : total === 0
          ? 'All trades are matched or already reviewed.'
          : done
          ? `${total} trade${total !== 1 ? 's' : ''} reviewed — you're all caught up.`
          : 'Link each trade to a plan, or mark it as off-plan if no plan applied.'}
      </p>

      {loadError ? (
        <LoadError title="Could not load trades to review" message={loadError} onRetry={() => setReloadKey(k => k + 1)} />
      ) : loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="w-6 h-6 border-2 border-gray-200 border-t-blue-600 rounded-full animate-spin" />
        </div>
      ) : total === 0 || done ? (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-6 py-12 text-center">
          <div className="w-16 h-16 bg-green-50 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h3 className="text-base font-semibold text-gray-900 mb-1">All caught up</h3>
          <p className="text-sm text-gray-400 mb-6">
            {total === 0 ? 'Nothing needs attention right now.' : 'Skipped trades stay on Daily View whenever you want to come back.'}
          </p>
          <button
            onClick={handleExit}
            className="bg-blue-600 text-white font-semibold py-3 px-6 rounded-xl text-sm hover:bg-blue-700"
          >
            Back to Home
          </button>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
          {/* Progress dots */}
          <div className="flex space-x-1.5 mb-5">
            {trades.map((_, i) => (
              <div
                key={i}
                className="h-1.5 rounded-full transition-all"
                style={{
                  width: i <= step ? 24 : 8,
                  background: i < step ? '#2563eb' : i === step ? '#2563eb' : '#e5e7eb',
                }}
              />
            ))}
          </div>

          <TradeCard trade={current} />

          {candidates.length === 0 ? (
            <p className="text-sm text-gray-400 mb-4">No matching plan found for this trade.</p>
          ) : (
            <>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">
                {candidates.length > 1
                  ? `${candidates.length} plans matched — pick the one you intended:`
                  : 'Suggested plan:'}
              </p>
              <div className="space-y-2 mb-5">
                {candidates.map(plan => {
                  const isSelected = selected === plan.id;
                  const planCurrency = plan.currency || current?.currency || 'USD';
                  const actualEntry = current?.avg_entry_price;
                  const actualQty = current?.total_opening_quantity;
                  const entryDelta = (plan.planned_entry_price != null && actualEntry != null)
                    ? ((actualEntry - plan.planned_entry_price) / plan.planned_entry_price) * 100
                    : null;
                  const qtyDelta = (plan.planned_quantity != null && actualQty != null && plan.planned_quantity > 0)
                    ? ((actualQty - plan.planned_quantity) / plan.planned_quantity) * 100
                    : null;
                  const entryOk = entryDelta != null && Math.abs(entryDelta) <= 2.5;
                  const qtyOk = qtyDelta != null && Math.abs(qtyDelta) === 0;
                  const entryWarn = entryDelta != null && Math.abs(entryDelta) > 5;
                  const qtyWarn = qtyDelta != null && Math.abs(qtyDelta) > 25;
                  const deltaClass = (entryWarn || qtyWarn)
                    ? 'text-red-500'
                    : (entryOk && qtyOk)
                    ? 'text-green-600 font-medium'
                    : 'text-amber-600';
                  const fmtPct = (n) => `${n > 0 ? '+' : ''}${n.toFixed(0)}%`;
                  return (
                    <label
                      key={plan.id}
                      className={`flex items-start gap-3 p-4 rounded-xl border cursor-pointer transition-colors ${
                        isSelected
                          ? 'border-blue-300 bg-blue-50 shadow-sm'
                          : 'border-gray-200 hover:border-blue-200 hover:bg-blue-50/30'
                      }`}
                    >
                      <input
                        type="radio"
                        name={`rs-${step}`}
                        value={plan.id}
                        checked={isSelected}
                        onChange={() => setSelected(plan.id)}
                        className="mt-0.5 flex-shrink-0"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="grid grid-cols-4 gap-2 mb-2">
                          <div className={`rounded-lg px-2 py-1.5 text-center ${isSelected ? 'bg-white border border-blue-100' : 'bg-gray-50'}`}>
                            <p className="text-[10px] text-gray-400 leading-none mb-0.5">Entry</p>
                            <p className="text-xs font-medium text-gray-900">
                              {plan.planned_entry_price != null ? fmtPrice(plan.planned_entry_price, planCurrency) : '—'}
                            </p>
                          </div>
                          <div className={`rounded-lg px-2 py-1.5 text-center ${isSelected ? 'bg-white border border-blue-100' : 'bg-gray-50'}`}>
                            <p className="text-[10px] text-gray-400 leading-none mb-0.5">Target</p>
                            <p className="text-xs font-medium text-green-600">
                              {plan.planned_target_price != null ? fmtPrice(plan.planned_target_price, planCurrency) : '—'}
                            </p>
                          </div>
                          <div className={`rounded-lg px-2 py-1.5 text-center ${isSelected ? 'bg-white border border-blue-100' : 'bg-gray-50'}`}>
                            <p className="text-[10px] text-gray-400 leading-none mb-0.5">Stop</p>
                            <p className="text-xs font-medium text-red-500">
                              {plan.planned_stop_loss != null ? fmtPrice(plan.planned_stop_loss, planCurrency) : '—'}
                            </p>
                          </div>
                          <div className={`rounded-lg px-2 py-1.5 text-center ${isSelected ? 'bg-white border border-blue-100' : 'bg-gray-50'}`}>
                            <p className="text-[10px] text-gray-400 leading-none mb-0.5">Qty</p>
                            <p className="text-xs font-medium text-gray-900">
                              {plan.planned_quantity ?? '—'}
                            </p>
                          </div>
                        </div>
                        {plan.thesis && (
                          <p className="text-[11px] text-gray-500 italic mb-1.5 line-clamp-2">
                            {plan.thesis}
                          </p>
                        )}
                        <div className="flex items-baseline justify-between gap-2">
                          <p className="text-[11px] text-gray-400 truncate">
                            Actual:{' '}
                            <span className="text-gray-700 font-medium">
                              {actualEntry != null ? fmtPrice(actualEntry, planCurrency) : '—'}
                              {actualQty != null && ` · ${actualQty} sh`}
                            </span>
                            {(entryDelta != null || qtyDelta != null) && (
                              <span className={deltaClass}>
                                {' · '}
                                {entryDelta != null && `entry ${fmtPct(entryDelta)}`}
                                {entryDelta != null && qtyDelta != null && ', '}
                                {qtyDelta != null && `qty ${qtyDelta === 0 ? '±0%' : fmtPct(qtyDelta)}`}
                              </span>
                            )}
                          </p>
                          <p className="text-[10px] text-gray-400 shrink-0">Created {fmtDate(plan.created_at)}</p>
                        </div>
                      </div>
                    </label>
                  );
                })}
              </div>
            </>
          )}

          {/* Action buttons */}
          <div className="flex gap-2">
            <button
              onClick={handleMatch}
              disabled={!selected || saving}
              className="flex-1 bg-blue-600 text-white font-semibold py-3 rounded-xl text-sm hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-1.5 transition-colors"
            >
              {saving ? 'Saving…' : (
                <>Match <span className="text-[10px] opacity-50 border border-white/30 rounded px-1 ml-0.5">↵</span></>
              )}
            </button>
            <button
              onClick={handleNoPlan}
              disabled={saving}
              className="flex-1 border border-gray-200 text-gray-700 font-medium py-3 rounded-xl text-sm hover:bg-gray-50 disabled:opacity-40 flex items-center justify-center gap-1.5 transition-colors"
            >
              No plan <span className="text-[10px] text-gray-400 border border-gray-200 rounded px-1">N</span>
            </button>
            <button
              onClick={handleSkip}
              disabled={saving}
              className="border border-gray-200 text-gray-400 font-medium py-3 px-4 rounded-xl text-sm hover:bg-gray-50 disabled:opacity-40 transition-colors"
            >
              Skip
            </button>
          </div>

          <p className="text-[11px] text-gray-300 text-center mt-3">
            <kbd className="px-1 py-0.5 bg-gray-50 border border-gray-200 rounded text-gray-500">↵</kbd> match ·
            <kbd className="ml-2 px-1 py-0.5 bg-gray-50 border border-gray-200 rounded text-gray-500">N</kbd> no plan ·
            <kbd className="ml-2 px-1 py-0.5 bg-gray-50 border border-gray-200 rounded text-gray-500">Esc</kbd> back
          </p>
        </div>
      )}
    </div>
  );
}

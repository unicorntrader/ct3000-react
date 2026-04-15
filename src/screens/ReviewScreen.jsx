import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabaseClient';
import { fmtPnl, fmtPrice, fmtDate } from '../lib/formatters';

// Full-page review workflow — replaces the old ReviewSheet bottom drawer.
// Wired from HomeScreen + DailyViewScreen review banners via <Link to="/review">
// or navigate('/review'). All the wizard logic is identical to the drawer
// version; only the container chrome changed from overlay+slide-up to a
// regular page with a back button.

function TradeCard({ trade }) {
  // Single-trade view: show in the trade's native currency, not base.
  const pnl = trade.total_realized_pnl || 0;
  const currency = trade.currency || 'USD';
  const isPositive = pnl >= 0;
  return (
    <div className="bg-gray-50 rounded-xl p-5 mb-6 border border-gray-100">
      <div className="flex justify-between items-start mb-3">
        <div>
          <span className="text-lg font-semibold text-gray-900">{trade.symbol}</span>
          <span className={`ml-2 text-xs font-medium px-2 py-0.5 rounded-full ${
            trade.matching_status === 'ambiguous'
              ? 'bg-purple-50 text-purple-700'
              : 'bg-amber-50 text-amber-700'
          }`}>
            {trade.matching_status === 'ambiguous' ? 'Ambiguous' : 'Unmatched'}
          </span>
        </div>
        <span className={`text-base font-semibold ${isPositive ? 'text-green-600' : 'text-red-500'}`}>
          {fmtPnl(pnl, currency)}
        </span>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {trade.avg_entry_price != null && (
          <div className="text-center"><p className="text-xs text-gray-400">Entry</p><p className="text-sm font-medium mt-0.5">{fmtPrice(trade.avg_entry_price, currency)}</p></div>
        )}
        {trade.total_opening_quantity && (
          <div className="text-center"><p className="text-xs text-gray-400">Qty</p><p className="text-sm font-medium mt-0.5">{trade.total_opening_quantity}</p></div>
        )}
        {trade.direction && (
          <div className="text-center"><p className="text-xs text-gray-400">Dir</p><p className="text-sm font-medium mt-0.5">{trade.direction}</p></div>
        )}
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
  const [saving, setSaving] = useState(false);

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
    setLoading(true);
    setStep(0);
    setSelected(null);

    const { data: reviewTrades } = await supabase
      .from('logical_trades')
      .select('*')
      .eq('user_id', session.user.id)
      .in('matching_status', ['unmatched', 'ambiguous'])
      .order('opened_at', { ascending: false });

    const tradeList = reviewTrades || [];
    setTrades(tradeList);

    if (tradeList.length > 0) {
      const { data: allPlans } = await supabase
        .from('planned_trades')
        .select('id, symbol, direction, asset_category, planned_entry_price, created_at, thesis')
        .eq('user_id', session.user.id);

      const plans = allPlans || [];
      const map = {};
      for (const t of tradeList) {
        map[t.id] = plans.filter(p =>
          p.symbol?.trim().toUpperCase() === t.symbol?.trim().toUpperCase() &&
          p.direction?.trim().toUpperCase() === t.direction?.trim().toUpperCase() &&
          p.asset_category?.trim().toUpperCase() === t.asset_category?.trim().toUpperCase()
        );
      }
      setCandidatesMap(map);
    }

    setLoading(false);
  }, [session]);

  useEffect(() => { loadReviewTrades(); }, [loadReviewTrades]);

  const handleExit = useCallback(() => navigate('/'), [navigate]);

  const handleMatch = useCallback(async () => {
    if (!current || !selected || saving) return;
    setSaving(true);
    const { error } = await supabase
      .from('logical_trades')
      .update({ matching_status: 'matched', planned_trade_id: selected })
      .eq('id', current.id)
      .eq('user_id', session.user.id);
    setSaving(false);
    if (error) {
      console.error('[review] match update failed:', error.message);
      alert(`Could not save match: ${error.message}`);
      return;
    }
    setSelected(null);
    setStep(s => s + 1);
  }, [current, selected, saving, session]);

  const handleNoPlan = useCallback(async () => {
    if (!current || saving) return;
    setSaving(true);
    const { error } = await supabase
      .from('logical_trades')
      .update({ matching_status: 'manual', planned_trade_id: null })
      .eq('id', current.id)
      .eq('user_id', session.user.id);
    setSaving(false);
    if (error) {
      console.error('[review] no-plan update failed:', error.message);
      alert(`Could not save: ${error.message}`);
      return;
    }
    setSelected(null);
    setStep(s => s + 1);
  }, [current, saving, session]);

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
          ? 'Fetching unmatched trades…'
          : total === 0
          ? 'All trades are matched or already reviewed.'
          : done
          ? `${total} trade${total !== 1 ? 's' : ''} reviewed — you're all caught up.`
          : 'Link each trade to a plan, or mark it as off-plan if no plan applied.'}
      </p>

      {loading ? (
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
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
                {candidates.length > 1 ? 'Multiple plans matched — choose one:' : 'Suggested plan:'}
              </p>
              <div className="space-y-2 mb-4">
                {candidates.map(plan => (
                  <label
                    key={plan.id}
                    className={`radio-label flex items-start space-x-3 p-3 rounded-xl border cursor-pointer transition-colors ${
                      selected === plan.id ? 'selected-blue border-blue-300' : 'border-gray-200'
                    }`}
                    onClick={() => setSelected(plan.id)}
                  >
                    <input
                      type="radio"
                      name={`rs-${step}`}
                      value={plan.id}
                      checked={selected === plan.id}
                      onChange={() => setSelected(plan.id)}
                      className="mt-0.5 flex-shrink-0"
                    />
                    <div>
                      <p className="text-sm font-medium text-gray-900">
                        {plan.symbol} — {(plan.direction || '').toUpperCase()}
                      </p>
                      <p className="text-xs text-gray-400 mt-0.5">
                        {fmtDate(plan.created_at)}
                        {plan.planned_entry_price != null && ` · Entry ${fmtPrice(plan.planned_entry_price)}`}
                        {plan.thesis && ` · ${plan.thesis.slice(0, 40)}`}
                      </p>
                    </div>
                  </label>
                ))}
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

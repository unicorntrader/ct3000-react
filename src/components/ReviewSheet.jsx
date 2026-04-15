import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabaseClient';
import { fmtPnl, fmtPrice, fmtDate, pnlBase } from '../lib/formatters';

function TradeCard({ trade, baseCurrency }) {
  const pnl = pnlBase(trade);
  const isPositive = pnl >= 0;
  return (
    <div className="bg-gray-50 rounded-xl p-4 mb-4 border border-gray-100">
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
          {fmtPnl(pnl, baseCurrency)}
        </span>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {trade.avg_entry_price != null && (
          <div className="text-center"><p className="text-xs text-gray-400">Entry</p><p className="text-sm font-medium mt-0.5">{fmtPrice(trade.avg_entry_price)}</p></div>
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

export default function ReviewSheet({ session, isOpen, onClose, onComplete }) {
  const [trades, setTrades] = useState([]);
  const [candidatesMap, setCandidatesMap] = useState({});
  const [baseCurrency, setBaseCurrency] = useState('USD');
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

    const [{ data: reviewTrades }, { data: creds }] = await Promise.all([
      supabase
        .from('logical_trades')
        .select('*')
        .eq('user_id', session.user.id)
        .in('matching_status', ['unmatched', 'ambiguous'])
        .order('opened_at', { ascending: false }),
      supabase
        .from('user_ibkr_credentials')
        .select('base_currency')
        .eq('user_id', session.user.id)
        .maybeSingle(),
    ]);

    if (creds?.base_currency) setBaseCurrency(creds.base_currency);

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

  useEffect(() => {
    if (isOpen) loadReviewTrades();
  }, [isOpen, loadReviewTrades]);

  const handleClose = useCallback(() => {
    setStep(0);
    setSelected(null);
    onClose();
  }, [onClose]);

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

  const handleDone = useCallback(() => {
    onComplete();
    handleClose();
  }, [onComplete, handleClose]);

  // Keyboard shortcuts: Enter=match, N=no plan, Escape=exit
  useEffect(() => {
    if (!isOpen || loading) return;
    const handler = (e) => {
      const isTyping = ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName);
      if (e.key === 'Escape') {
        e.preventDefault();
        handleClose();
      } else if (e.key === 'Enter' && !e.shiftKey && !isTyping) {
        e.preventDefault();
        if (done) handleDone();
        else if (selected) handleMatch();
      } else if ((e.key === 'n' || e.key === 'N') && !isTyping) {
        e.preventDefault();
        if (!done) handleNoPlan();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, loading, selected, done, handleClose, handleMatch, handleNoPlan, handleDone]);

  return (
    <>
      <div className={`overlay-bg ${isOpen ? 'open' : ''}`} onClick={handleClose} />
      <div className={`slide-up ${isOpen ? 'open' : ''}`}>
        <div className="px-5 pt-3 pb-8">
          <div className="w-10 h-1 bg-gray-200 rounded-full mx-auto mb-4" />

          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-base font-semibold text-gray-900">
                {loading ? 'Loading…' : done ? 'Review complete' : 'Review trades'}
              </h3>
              {!loading && !done && current && (
                <p className="text-xs text-gray-400 mt-0.5">
                  Trade {step + 1} of {total}
                </p>
              )}
            </div>
            <button onClick={handleClose} className="text-gray-400 hover:text-gray-600 p-1">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="w-5 h-5 border-2 border-gray-200 border-t-blue-600 rounded-full animate-spin" />
            </div>
          ) : total === 0 ? (
            <div className="text-center py-6">
              <div className="w-14 h-14 bg-green-50 rounded-full flex items-center justify-center mx-auto mb-3">
                <svg className="w-7 h-7 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h3 className="text-base font-semibold text-gray-900 mb-1">Nothing to review</h3>
              <p className="text-sm text-gray-400 mb-6">All trades are matched or already reviewed.</p>
              <button onClick={handleClose} className="w-full bg-blue-600 text-white font-semibold py-3 rounded-xl text-sm hover:bg-blue-700">
                Close
              </button>
            </div>
          ) : (
            <>
              {/* Progress dots */}
              <div className="flex space-x-1.5 mb-5">
                {trades.map((_, i) => (
                  <div
                    key={i}
                    className="h-1.5 rounded-full transition-all"
                    style={{
                      width: i <= step ? 24 : 8,
                      background: i < step ? '#2563eb' : i === step && !done ? '#2563eb' : '#e5e7eb',
                    }}
                  />
                ))}
              </div>

              {done ? (
                <div className="text-center py-6">
                  <div className="w-14 h-14 bg-green-50 rounded-full flex items-center justify-center mx-auto mb-3">
                    <svg className="w-7 h-7 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                  <h3 className="text-base font-semibold text-gray-900 mb-1">All caught up</h3>
                  <p className="text-sm text-gray-400 mb-1">{total} trade{total !== 1 ? 's' : ''} reviewed</p>
                  <p className="text-xs text-gray-400 mb-6">Skipped trades still appear in Daily View whenever you're ready.</p>
                  <button onClick={handleDone} className="w-full bg-blue-600 text-white font-semibold py-3 rounded-xl text-sm hover:bg-blue-700">
                    Done <span className="opacity-60 text-xs ml-1">↵</span>
                  </button>
                </div>
              ) : (
                <>
                  <TradeCard trade={current} baseCurrency={baseCurrency} />

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
                                {(plan.notes || plan.thesis) && ` · ${(plan.notes || plan.thesis).slice(0, 40)}`}
                              </p>
                            </div>
                          </label>
                        ))}
                      </div>
                    </>
                  )}

                  {/* Keyboard hint */}
                  <p className="text-xs text-gray-300 text-center mb-3">
                    {selected ? '↵ Match' : ''}{selected ? ' · ' : ''}N No plan · Esc Exit
                  </p>

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
                </>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}

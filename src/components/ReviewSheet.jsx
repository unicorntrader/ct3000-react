import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabaseClient';

const fmtPnl = (n) => {
  if (n == null) return '—';
  const abs = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (n >= 0 ? '+$' : '-$') + abs;
};

const fmtPrice = (n) => {
  if (n == null) return null;
  return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const fmtDate = (iso) => {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

function TradeCard({ trade }) {
  const pnl = trade.total_realized_pnl || 0;
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
          {fmtPnl(pnl)}
        </span>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {fmtPrice(trade.avg_entry_price) && (
          <div className="text-center"><p className="text-xs text-gray-400">Entry</p><p className="text-sm font-medium mt-0.5">{fmtPrice(trade.avg_entry_price)}</p></div>
        )}
        {trade.total_opening_quantity && (
          <div className="text-center"><p className="text-xs text-gray-400">Qty</p><p className="text-sm font-medium mt-0.5">{trade.total_opening_quantity}</p></div>
        )}
        {trade.direction && (
          <div className="text-center"><p className="text-xs text-gray-400">Direction</p><p className="text-sm font-medium mt-0.5">{trade.direction}</p></div>
        )}
        {trade.status === 'open' && (
          <div className="text-center"><p className="text-xs text-gray-400">Status</p><p className="text-sm font-medium text-blue-600 mt-0.5">Open</p></div>
        )}
        {trade.currency && (
          <div className="text-center"><p className="text-xs text-gray-400">Currency</p><p className="text-sm font-medium mt-0.5">{trade.currency}</p></div>
        )}
      </div>
    </div>
  );
}

export default function ReviewSheet({ session, isOpen, onClose, onComplete }) {
  const [trades, setTrades] = useState([]);
  const [candidatesMap, setCandidatesMap] = useState({});
  const [step, setStep] = useState(0);
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (isOpen && session?.user?.id) {
      loadReviewTrades();
    }
  }, [isOpen, session]);

  const loadReviewTrades = async () => {
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
        .select('id, symbol, direction, asset_category, entry_price, entry, created_at, notes, thesis')
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
  };

  const current = trades[step] || null;
  const total = trades.length;
  const done = step >= total;

  const handleConfirm = async () => {
    if (!current || !selected) return;
    setSaving(true);

    if (selected === '__unplanned__') {
      await supabase
        .from('logical_trades')
        .update({ matching_status: 'manual', planned_trade_id: null })
        .eq('id', current.id);
    } else {
      await supabase
        .from('logical_trades')
        .update({ matching_status: 'matched', planned_trade_id: selected })
        .eq('id', current.id);
    }

    setSaving(false);
    setSelected(null);
    setStep(s => s + 1);
  };

  const handleSkip = () => {
    setSelected(null);
    setStep(s => s + 1);
  };

  const handleClose = () => {
    setStep(0);
    setSelected(null);
    onClose();
  };

  const handleDone = () => {
    onComplete();
    handleClose();
  };

  return (
    <>
      <div className={`overlay-bg ${isOpen ? 'open' : ''}`} onClick={handleClose} />
      <div className={`slide-up ${isOpen ? 'open' : ''}`}>
        <div className="px-5 pt-3 pb-8">
          <div className="w-10 h-1 bg-gray-200 rounded-full mx-auto mb-4" />

          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-base font-semibold text-gray-900">
                {loading ? 'Loading...' : done ? 'Review complete' : 'Review trades'}
              </h3>
              {!loading && !done && current && (
                <p className="text-xs text-gray-400 mt-0.5">
                  Step {step + 1} of {total} &middot; {current.symbol} {current.matching_status}
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
                    Done
                  </button>
                </div>
              ) : (
                <>
                  <TradeCard trade={current} />

                  {current.matching_status === 'ambiguous' && (
                    <p className="text-xs text-gray-400 mb-3">2 plans matched — which one is it?</p>
                  )}

                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
                    {current.matching_status === 'ambiguous' ? 'Choose the correct plan:' : 'Match to a plan:'}
                  </p>

                  <div className="space-y-2 mb-4">
                    {(candidatesMap[current.id] || []).map(plan => (
                      <label
                        key={plan.id}
                        className={`radio-label flex items-start space-x-3 p-3 rounded-xl border border-gray-200 cursor-pointer ${
                          selected === plan.id ? 'selected-blue' : ''
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
                            {(plan.entry_price ?? plan.entry) != null && ` · Entry ${fmtPrice(plan.entry_price ?? plan.entry)}`}
                            {(plan.notes || plan.thesis) && ` · ${(plan.notes || plan.thesis).slice(0, 40)}`}
                          </p>
                        </div>
                      </label>
                    ))}

                    <label
                      className={`radio-label flex items-start space-x-3 p-3 rounded-xl border border-gray-200 cursor-pointer ${
                        selected === '__unplanned__' ? 'selected-red' : ''
                      }`}
                      onClick={() => setSelected('__unplanned__')}
                    >
                      <input
                        type="radio"
                        name={`rs-${step}`}
                        value="__unplanned__"
                        checked={selected === '__unplanned__'}
                        onChange={() => setSelected('__unplanned__')}
                        className="mt-0.5 flex-shrink-0"
                      />
                      <div>
                        <p className="text-sm font-medium text-gray-900">Mark as unplanned</p>
                        <p className="text-xs text-gray-400 mt-0.5">Discretionary trade — no plan</p>
                      </div>
                    </label>
                  </div>

                  <div className="flex space-x-2">
                    <button
                      onClick={handleConfirm}
                      disabled={!selected || saving}
                      className="flex-1 bg-blue-600 text-white font-semibold py-3 rounded-xl text-sm hover:bg-blue-700 disabled:opacity-40"
                    >
                      {saving ? 'Saving...' : 'Confirm →'}
                    </button>
                    <button
                      onClick={handleSkip}
                      className="border border-gray-200 text-gray-500 font-medium py-3 px-4 rounded-xl text-sm hover:bg-gray-50"
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

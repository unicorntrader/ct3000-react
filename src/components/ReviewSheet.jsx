import React, { useState } from 'react';
import { reviewTrades } from '../data/mockData';

function TradeCard({ trade }) {
  return (
    <div className="bg-gray-50 rounded-xl p-4 mb-4 border border-gray-100">
      <div className="flex justify-between items-start mb-3">
        <div>
          <span className="text-lg font-semibold text-gray-900">{trade.symbol}</span>
          <span className={`ml-2 text-xs font-medium px-2 py-0.5 rounded-full ${
            trade.type === 'ambiguous'
              ? 'bg-purple-50 text-purple-700'
              : 'bg-amber-50 text-amber-700'
          }`}>
            {trade.type === 'ambiguous' ? 'Ambiguous' : 'Unmatched'}
          </span>
        </div>
        <span className={`text-base font-semibold ${trade.positive ? 'text-green-600' : 'text-red-500'}`}>
          {trade.pnl}
        </span>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {trade.entry && <div className="text-center"><p className="text-xs text-gray-400">Entry</p><p className="text-sm font-medium mt-0.5">{trade.entry}</p></div>}
        {trade.exit && <div className="text-center"><p className="text-xs text-gray-400">Exit</p><p className="text-sm font-medium mt-0.5">{trade.exit}</p></div>}
        {trade.qty && <div className="text-center"><p className="text-xs text-gray-400">Qty</p><p className="text-sm font-medium mt-0.5">{trade.qty}</p></div>}
        {trade.duration && <div className="text-center"><p className="text-xs text-gray-400">Duration</p><p className="text-sm font-medium mt-0.5">{trade.duration}</p></div>}
        {trade.status && <div className="text-center"><p className="text-xs text-gray-400">Status</p><p className="text-sm font-medium text-blue-600 mt-0.5">{trade.status}</p></div>}
        {trade.currency && <div className="text-center"><p className="text-xs text-gray-400">Currency</p><p className="text-sm font-medium mt-0.5">{trade.currency}</p></div>}
      </div>
    </div>
  );
}

export default function ReviewSheet({ isOpen, onClose, onComplete }) {
  const [step, setStep] = useState(0);
  const [selected, setSelected] = useState(null);
  const total = reviewTrades.length;
  const done = step >= total;

  const handleNext = () => {
    setSelected(null);
    if (step < total) setStep(s => s + 1);
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

  const current = reviewTrades[step] || null;

  return (
    <>
      <div className={`overlay-bg ${isOpen ? 'open' : ''}`} onClick={handleClose} />
      <div className={`slide-up ${isOpen ? 'open' : ''}`}>
        <div className="px-5 pt-3 pb-8">
          <div className="w-10 h-1 bg-gray-200 rounded-full mx-auto mb-4" />

          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-base font-semibold text-gray-900">
                {done ? 'Review complete' : 'Review trades'}
              </h3>
              {!done && (
                <p className="text-xs text-gray-400 mt-0.5">
                  Step {step + 1} of {total} &middot; {current?.symbol} {current?.type}
                </p>
              )}
            </div>
            <button onClick={handleClose} className="text-gray-400 hover:text-gray-600 p-1">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="flex space-x-1.5 mb-5">
            {reviewTrades.map((_, i) => (
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
              <p className="text-sm text-gray-400 mb-1">{total} trades reviewed</p>
              <p className="text-xs text-gray-400 mb-6">Skipped trades still appear in Daily View whenever you're ready.</p>
              <button onClick={handleDone} className="w-full bg-blue-600 text-white font-semibold py-3 rounded-xl text-sm hover:bg-blue-700">
                Done
              </button>
            </div>
          ) : (
            <>
              <TradeCard trade={current} />

              {current.note && (
                <p className="text-xs text-gray-400 mb-3">{current.note}</p>
              )}

              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
                {current.type === 'unmatched' && !current.note ? 'Match to a plan:' : current.type === 'ambiguous' ? '2 plans matched -- which one is it?' : 'Choose an action:'}
              </p>

              <div className="space-y-2 mb-4">
                {current.candidates.map(c => (
                  <label
                    key={c.value}
                    className={`radio-label flex items-start space-x-3 p-3 rounded-xl border border-gray-200 ${
                      selected === c.value ? (c.danger ? 'selected-red' : 'selected-blue') : ''
                    }`}
                    onClick={() => setSelected(c.value)}
                  >
                    <input
                      type="radio"
                      name={`rs-${step}`}
                      value={c.value}
                      checked={selected === c.value}
                      onChange={() => setSelected(c.value)}
                      className="mt-0.5 flex-shrink-0"
                    />
                    <div>
                      <p className="text-sm font-medium text-gray-900">{c.label}</p>
                      <p className="text-xs text-gray-400 mt-0.5">{c.sub}</p>
                    </div>
                  </label>
                ))}
              </div>

              <div className="flex space-x-2">
                <button
                  onClick={handleNext}
                  className="flex-1 bg-blue-600 text-white font-semibold py-3 rounded-xl text-sm hover:bg-blue-700"
                >
                  Confirm &rarr;
                </button>
                <button
                  onClick={handleNext}
                  className="border border-gray-200 text-gray-500 font-medium py-3 px-4 rounded-xl text-sm hover:bg-gray-50"
                >
                  Skip
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}

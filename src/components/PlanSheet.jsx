import React, { useState } from 'react';

const strategies = [
  { group: 'Timeframe', options: ['Day Trade', 'Swing', 'Position'] },
  { group: 'Setup', options: ['Breakout', 'Support', 'Resistance', 'Momentum'] },
  { group: 'Thesis-driven', options: ['Value', 'Fundamental', 'Macro', 'Catalyst'] },
];

export default function PlanSheet({ isOpen, onClose }) {
  const [direction, setDirection] = useState('long');
  const [entry, setEntry] = useState('');
  const [target, setTarget] = useState('');
  const [stop, setStop] = useState('');
  const [qty, setQty] = useState('');

  const e = parseFloat(entry) || 0;
  const t = parseFloat(target) || 0;
  const s = parseFloat(stop) || 0;
  const q = parseFloat(qty) || 0;

  const posSize = e && q ? `$${(e * q).toLocaleString('en-US', { maximumFractionDigits: 0 })}` : '--';
  const risk = e && s && q ? `$${(Math.abs(e - s) * q).toLocaleString('en-US', { maximumFractionDigits: 0 })}` : '--';
  const reward = e && t && q ? `$${(Math.abs(t - e) * q).toLocaleString('en-US', { maximumFractionDigits: 0 })}` : '--';
  const rr = e && s && t ? (Math.abs(t - e) / Math.abs(e - s)).toFixed(2) + 'R' : '--';
  const rrColor = e && s && t
    ? parseFloat(rr) >= 2 ? 'text-green-600' : parseFloat(rr) >= 1 ? 'text-amber-500' : 'text-red-500'
    : 'text-gray-700';

  const showCalc = e > 0 && q > 0;

  return (
    <>
      <div className={`overlay-bg ${isOpen ? 'open' : ''}`} onClick={onClose} />
      <div className={`slide-up ${isOpen ? 'open' : ''}`}>
        <div className="px-5 pt-3 pb-8">
          <div className="w-10 h-1 bg-gray-200 rounded-full mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-gray-900 mb-4">New plan</h3>

          <div className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1.5">
                Ticker <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                placeholder="AAPL, ES, EUR/USD..."
                className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-400 bg-gray-50 uppercase"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1.5">
                Strategy <span className="text-red-400">*</span>
              </label>
              <select className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-gray-50 text-gray-700">
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
                onChange={e => setEntry(e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-gray-50"
              />
            </div>

            <div className="border-t border-gray-100 pt-4">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Optional</p>
              <div className="grid grid-cols-3 gap-2 mb-3">
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Target</label>
                  <input type="number" placeholder="0.00" value={target} onChange={e => setTarget(e.target.value)}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-gray-50" />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Stop loss</label>
                  <input type="number" placeholder="0.00" value={stop} onChange={e => setStop(e.target.value)}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-gray-50" />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Quantity</label>
                  <input type="number" placeholder="0" value={qty} onChange={e => setQty(e.target.value)}
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
                className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-gray-50 resize-none"
              />
            </div>

            <button
              onClick={onClose}
              className="w-full bg-blue-600 text-white font-semibold py-3.5 rounded-xl text-sm hover:bg-blue-700 transition-colors"
            >
              Save plan
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

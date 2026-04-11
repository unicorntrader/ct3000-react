import React from 'react';
import { fmtPrice, fmtPnl } from '../lib/formatters';
import { usePrivacy } from '../lib/PrivacyContext';

// row: { symbol, direction, nativePnl, currency, entry, qty, closingQty, assetCategory, plannedTradeId }
// plannedStop: plan.planned_stop_loss or null
export default function ShareModal({ row, plannedStop, onClose }) {
  const { isPrivate } = usePrivacy();
  const MASK = '••••';

  const pnl = row.nativePnl;
  const currency = row.currency || 'USD';
  const isWin = (pnl || 0) >= 0;
  const outcomeEmoji = isWin ? '✅' : '❌';
  const dirLabel = (row.direction || '').toUpperCase();
  const displaySymbol = (row.symbol || '').split(' ')[0];

  const multiplier = row.assetCategory === 'OPT' ? 100 : 1;

  // Weighted average exit: derived from realized P&L, entry, and closing quantity
  const avgExit = (row.entry != null && row.closingQty != null && row.closingQty !== 0)
    ? (pnl / (row.closingQty * multiplier)) + row.entry
    : null;

  const pctReturn = avgExit != null && row.entry !== 0
    ? (((avgExit - row.entry) / row.entry) * 100).toFixed(2)
    : null;

  const rMultiple = (plannedStop != null && row.entry != null && row.qty != null && row.qty !== 0)
    ? (() => {
        const risk = Math.abs(row.entry - plannedStop) * row.qty;
        if (risk === 0) return null;
        return (pnl / risk).toFixed(2);
      })()
    : null;

  const entryDisplay = row.entry != null ? (isPrivate ? MASK : fmtPrice(row.entry, currency)) : '—';
  const exitDisplay = avgExit != null ? (isPrivate ? MASK : fmtPrice(avgExit, currency)) : '—';
  const pnlDisplay = isPrivate ? MASK : fmtPnl(pnl, currency);
  const pctDisplay = pctReturn != null ? `${pctReturn}%` : '—';
  const rDisplay = rMultiple != null ? `${rMultiple}R` : null;

  const handleShareOnX = () => {
    const p = isPrivate ? MASK : fmtPnl(pnl, currency);
    const pct = pctReturn != null ? `${pctReturn}%` : '—';
    const en = row.entry != null ? (isPrivate ? MASK : fmtPrice(row.entry, currency)) : '—';
    const ex = avgExit != null ? (isPrivate ? MASK : fmtPrice(avgExit, currency)) : '—';
    let text = `${displaySymbol} ${dirLabel} ${outcomeEmoji}\nEntry: ${en} → Exit: ${ex}\nP&L: ${p} (${pct})`;
    if (rMultiple != null) text += `\nR: ${rMultiple}R`;
    text += '\n#CT3000';
    window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`, '_blank');
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-sm mx-4"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-base font-semibold text-gray-900">Share trade</h3>
          <button
            onClick={onClose}
            className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="bg-gray-50 rounded-xl p-4 mb-5 border border-gray-100">
          <div className="flex items-center space-x-2 mb-3">
            <span className="text-xl font-bold text-gray-900">{displaySymbol}</span>
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
              dirLabel === 'LONG' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'
            }`}>
              {dirLabel}
            </span>
            <span className="text-lg">{outcomeEmoji}</span>
          </div>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div>
              <p className="text-xs text-gray-400 mb-0.5">Entry</p>
              <p className="font-medium text-gray-800">{entryDisplay}</p>
            </div>
            <div>
              <p className="text-xs text-gray-400 mb-0.5">Exit</p>
              <p className="font-medium text-gray-800">{exitDisplay}</p>
            </div>
            <div>
              <p className="text-xs text-gray-400 mb-0.5">P&L</p>
              <p className={`font-semibold ${isPrivate ? 'text-gray-400' : isWin ? 'text-green-600' : 'text-red-500'}`}>{pnlDisplay}</p>
            </div>
            <div>
              <p className="text-xs text-gray-400 mb-0.5">Return</p>
              <p className={`font-medium ${isWin ? 'text-green-600' : 'text-red-500'}`}>{pctDisplay}</p>
            </div>
            {rDisplay != null && (
              <div>
                <p className="text-xs text-gray-400 mb-0.5">R-multiple</p>
                <p className="font-medium text-blue-600">{rDisplay}</p>
              </div>
            )}
          </div>
        </div>

        <button
          onClick={handleShareOnX}
          className="w-full flex items-center justify-center space-x-2 bg-black text-white text-sm font-medium py-2.5 rounded-xl hover:bg-gray-800 transition-colors"
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
            <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.74l7.73-8.835L1.254 2.25H8.08l4.259 5.632 5.905-5.632zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
          </svg>
          <span>Share on X</span>
        </button>
      </div>
    </div>
  );
}

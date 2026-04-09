import React from 'react';
import { openPositions, activePlans } from '../data/mockData';

export default function HomeScreen({ onTabChange, onReviewOpen, reviewDismissed }) {
  return (
    <div>
      {!reviewDismissed && (
        <div
          className="bg-amber-50 border border-amber-200 rounded-xl p-3 flex items-center space-x-3 cursor-pointer mb-6"
          onClick={onReviewOpen}
        >
          <div className="w-8 h-8 bg-amber-100 rounded-full flex items-center justify-center flex-shrink-0">
            <svg className="w-4 h-4 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <div className="flex-1">
            <p className="text-sm font-medium text-amber-800">4 trades need review</p>
            <p className="text-xs text-amber-600">Tap to review now -- takes about 2 minutes</p>
          </div>
          <svg className="w-4 h-4 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {[
          { label: "Today's P&L", value: '+$970', sub: '3 trades', color: 'text-green-600' },
          { label: 'Open positions', value: '3', sub: '+$1,670 unrealized', color: 'text-blue-600' },
          { label: 'Active plans', value: '2', sub: 'Ready to execute', color: 'text-gray-900' },
          { label: 'Win rate (30d)', value: '62%', sub: '31W · 19L', color: 'text-green-600' },
        ].map(card => (
          <div key={card.label} className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
            <p className="text-xs font-medium text-gray-400 mb-1">{card.label}</p>
            <p className={`text-2xl font-semibold ${card.color}`}>{card.value}</p>
            <p className="text-xs text-gray-400 mt-1">{card.sub}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-gray-700">Open positions</h3>
            <button onClick={() => onTabChange('daily')} className="text-xs text-blue-600 font-medium hover:underline">View all &rarr;</button>
          </div>
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 divide-y divide-gray-50">
            {openPositions.map(pos => (
              <div key={pos.symbol} className="flex items-center justify-between px-5 py-3">
                <div>
                  <p className="font-semibold text-gray-900">{pos.symbol}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{pos.direction} &middot; {pos.qty} shares &middot; {pos.days} days</p>
                </div>
                <div className="text-right">
                  <p className={`font-semibold ${pos.positive ? 'text-green-600' : 'text-red-500'}`}>{pos.pnl}</p>
                  <p className="text-xs text-gray-400 mt-0.5">avg {pos.avg}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-gray-700">Active plans</h3>
            <button onClick={() => onTabChange('plans')} className="text-xs text-blue-600 font-medium hover:underline">View all &rarr;</button>
          </div>
          <div className="space-y-3">
            {activePlans.map(plan => (
              <div key={plan.symbol} className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="font-semibold text-gray-900">{plan.symbol}</span>
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                    plan.direction === 'long' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'
                  }`}>
                    {plan.direction.toUpperCase()}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-2 mb-2">
                  <div className="text-center bg-gray-50 rounded-lg py-1.5"><p className="text-xs text-gray-400 mb-0.5">Entry</p><p className="text-sm font-medium">{plan.entry}</p></div>
                  <div className="text-center bg-gray-50 rounded-lg py-1.5"><p className="text-xs text-gray-400 mb-0.5">Target</p><p className="text-sm font-medium text-green-600">{plan.target}</p></div>
                  <div className="text-center bg-gray-50 rounded-lg py-1.5"><p className="text-xs text-gray-400 mb-0.5">Stop</p><p className="text-sm font-medium text-red-500">{plan.stop}</p></div>
                </div>
                <p className="text-xs text-gray-500 italic">{plan.thesis}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

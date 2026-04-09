import React, { useState } from 'react';
import { journalTrades } from '../data/mockData';

const FILTERS = ['All', 'Wins', 'Losses', 'Unmatched', 'Breakout', 'Momentum'];

const planStyles = {
  matched: 'bg-blue-50 text-blue-600',
  unmatched: 'bg-amber-50 text-amber-600',
};

export default function JournalScreen() {
  const [activeFilter, setActiveFilter] = useState('All');

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-semibold text-gray-900">Smart Journal</h2>
      </div>

      <div className="grid grid-cols-3 gap-4 mb-6">
        {[
          { label: 'Trades', value: '34', color: 'text-gray-900' },
          { label: 'Win rate', value: '62%', color: 'text-green-600' },
          { label: 'Adherence', value: '84%', color: 'text-blue-600' },
        ].map(c => (
          <div key={c.label} className="bg-white rounded-xl p-4 text-center shadow-sm border border-gray-100">
            <p className="text-xs text-gray-400 mb-1">{c.label}</p>
            <p className={`text-2xl font-semibold ${c.color}`}>{c.value}</p>
          </div>
        ))}
      </div>

      <div className="flex space-x-2 mb-5 overflow-x-auto pb-1">
        {FILTERS.map(f => (
          <button
            key={f}
            onClick={() => setActiveFilter(f)}
            className={`text-xs font-medium px-4 py-1.5 rounded-full whitespace-nowrap border transition-colors ${
              activeFilter === f
                ? 'bg-blue-600 text-white border-transparent'
                : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50">
            <tr>
              {['Date', 'Symbol', 'Tags', 'P&L', 'R', 'Outcome', 'Adherence', 'Plan'].map(h => (
                <th key={h} className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {journalTrades.map((trade, i) => (
              <tr key={i} className="hover:bg-gray-50 cursor-pointer">
                <td className="px-6 py-4 text-sm text-gray-600">{trade.date}</td>
                <td className="px-6 py-4 text-sm font-semibold text-gray-900">{trade.symbol}</td>
                <td className="px-6 py-4">
                  <div className="flex flex-wrap gap-1">
                    {trade.tags.map(tag => (
                      <span key={tag} className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">{tag}</span>
                    ))}
                  </div>
                </td>
                <td className={`px-6 py-4 text-sm font-semibold ${trade.outcome === 'win' ? 'text-green-600' : 'text-red-500'}`}>{trade.pnl}</td>
                <td className="px-6 py-4 text-sm text-gray-600">{trade.r}</td>
                <td className="px-6 py-4">
                  <span className={`px-2.5 py-1 text-xs rounded-full font-medium ${
                    trade.outcome === 'win' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-700'
                  }`}>{trade.outcome}</span>
                </td>
                <td className="px-6 py-4">
                  {trade.adherence ? (
                    <div className="flex items-center space-x-2">
                      <span className="text-sm text-gray-700">{trade.adherence}%</span>
                      <div className="w-16 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        <div className="adh-bar-fill" style={{ width: `${trade.adherence}%` }} />
                      </div>
                    </div>
                  ) : (
                    <span className="text-sm text-gray-400">--</span>
                  )}
                </td>
                <td className="px-6 py-4">
                  <span className={`px-2 py-0.5 text-xs rounded-full font-medium ${planStyles[trade.plan]}`}>
                    {trade.plan.charAt(0).toUpperCase() + trade.plan.slice(1)}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

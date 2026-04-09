import React, { useState } from 'react';
import { insightCards } from '../data/mockData';

const PERIODS = ['All', '3M', '1M', '1W'];
const dotColors = { red: 'bg-red-400', green: 'bg-green-400', blue: 'bg-blue-400' };
const actionColors = {
  red: 'bg-red-50 text-red-600',
  green: 'bg-green-50 text-green-700',
  blue: 'bg-blue-50 text-blue-600',
};

export default function PerformanceScreen() {
  const [period, setPeriod] = useState('All');
  const [perfTab, setPerfTab] = useState('overview');

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-semibold text-gray-900">Performance</h2>
        <div className="flex space-x-2">
          {PERIODS.map(p => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`text-xs font-medium px-4 py-1.5 rounded-full whitespace-nowrap border transition-colors ${
                period === p
                  ? 'bg-blue-600 text-white border-transparent'
                  : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
              }`}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Net P&L', value: '+$15,430', sub: '50 closed trades', color: 'text-green-600' },
          { label: 'Win rate', value: '62%', sub: '31W · 19L', color: 'text-gray-900' },
          { label: 'Profit factor', value: '2.44', sub: 'Avg win $780', color: 'text-gray-900' },
          { label: 'Expectancy', value: '+$308', sub: 'per trade', color: 'text-green-600' },
        ].map(card => (
          <div key={card.label} className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
            <p className="text-xs font-medium text-gray-400 mb-1">{card.label}</p>
            <p className={`text-2xl font-semibold ${card.color}`}>{card.value}</p>
            <p className="text-xs text-gray-400 mt-1">{card.sub}</p>
          </div>
        ))}
      </div>

      <div className="flex border-b border-gray-200 mb-6">
        {['overview', 'insights'].map(tab => (
          <button
            key={tab}
            onClick={() => setPerfTab(tab)}
            className={`text-sm font-medium px-5 py-3 border-b-2 transition-colors ${
              perfTab === tab
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>

      {perfTab === 'overview' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
            <h3 className="text-sm font-semibold text-gray-700 mb-4">Performance breakdown</h3>
            <div className="space-y-0">
              {[
                { label: 'Gross profit', value: '+$24,180', color: 'text-green-600' },
                { label: 'Gross loss', value: '-$8,750', color: 'text-red-500' },
                { label: 'Commissions', value: '-$420', color: 'text-gray-700' },
                { label: 'Avg winner', value: '+$780', color: 'text-green-600' },
                { label: 'Avg loser', value: '-$320', color: 'text-red-500' },
                { label: 'Plan adherence', value: '73%', color: 'text-blue-600' },
                { label: 'Unplanned P&L', value: '-$858', color: 'text-red-500' },
              ].map((row, i, arr) => (
                <div key={row.label} className={`flex justify-between py-3 ${i < arr.length - 1 ? 'border-b border-gray-50' : ''}`}>
                  <span className="text-sm text-gray-500">{row.label}</span>
                  <span className={`text-sm font-semibold ${row.color}`}>{row.value}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 flex items-center justify-center">
            <div className="text-center py-8">
              <svg className="w-10 h-10 text-gray-200 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
              <p className="text-sm text-gray-400">Equity curve -- coming soon</p>
            </div>
          </div>
        </div>
      )}

      {perfTab === 'insights' && (
        <div className="space-y-3">
          {insightCards.map((card, i) => (
            <div key={i} className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
              <div className="flex items-start space-x-3">
                <span className={`mt-1 w-2 h-2 rounded-full flex-shrink-0 ${dotColors[card.color]}`} />
                <div className="flex-1">
                  <p className="text-sm font-semibold text-gray-900 mb-1">{card.title}</p>
                  <p className="text-sm text-gray-500 leading-relaxed mb-3">{card.body}</p>
                  <span className={`text-xs px-3 py-1.5 rounded-lg font-medium ${actionColors[card.color]}`}>
                    {card.action}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

import React from 'react';
import { plans } from '../data/mockData';

const statusStyles = {
  planned: 'bg-blue-50 text-blue-600',
  matched: 'bg-green-50 text-green-700',
};

export default function PlansScreen({ onNewPlan }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-semibold text-gray-900">Plans</h2>
        <button
          onClick={onNewPlan}
          className="flex items-center space-x-1.5 bg-blue-600 text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          <span>New plan</span>
        </button>
      </div>

      <div className="space-y-4">
        {plans.map((plan, i) => (
          <div key={i} className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
            <div className="flex items-start justify-between mb-4">
              <div>
                <div className="flex items-center space-x-3 mb-1">
                  <span className="text-xl font-semibold text-gray-900">{plan.symbol}</span>
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                    plan.direction === 'long' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'
                  }`}>
                    {plan.direction.toUpperCase()}
                  </span>
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${statusStyles[plan.status]}`}>
                    {plan.status.toUpperCase()}
                  </span>
                </div>
                <p className="text-xs text-gray-400">{plan.date} &middot; {plan.shares} shares &middot; R:R {plan.rr}</p>
              </div>
            </div>
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-3 mb-4">
              {[
                { label: 'Entry', value: plan.entry },
                { label: 'Target', value: plan.target, color: 'text-green-600' },
                { label: 'Stop', value: plan.stop, color: 'text-red-500' },
                { label: 'Risk', value: plan.risk, color: 'text-red-500' },
                { label: 'Reward', value: plan.reward, color: 'text-green-600' },
                { label: 'R:R', value: plan.rr, color: 'text-blue-600' },
              ].map(f => (
                <div key={f.label} className="text-center bg-gray-50 rounded-lg py-2">
                  <p className="text-xs text-gray-400 mb-1">{f.label}</p>
                  <p className={`text-sm font-medium ${f.color || ''}`}>{f.value}</p>
                </div>
              ))}
            </div>
            <p className="text-sm text-gray-500 italic">{plan.thesis}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabaseClient';

const fmtPrice = (n) => {
  if (n == null) return 'N/A';
  return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const fmtDate = (iso) => {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

const statusStyles = {
  planned: 'bg-blue-50 text-blue-600',
  matched: 'bg-green-50 text-green-700',
  active: 'bg-blue-50 text-blue-600',
};

export default function PlansScreen({ session, onNewPlan, refreshKey }) {
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!session?.user?.id) return;
    fetchPlans();
  }, [session, refreshKey]);

  const fetchPlans = async () => {
    const { data } = await supabase
      .from('planned_trades')
      .select('*')
      .eq('user_id', session.user.id)
      .order('created_at', { ascending: false });

    setPlans(data || []);
    setLoading(false);
  };

  const computeRR = (plan) => {
    const { planned_entry_price: entry, planned_target_price: target, planned_stop_loss: stop } = plan;
    if (entry == null || target == null || stop == null) return null;
    const risk = Math.abs(entry - stop);
    if (risk === 0) return null;
    return (Math.abs(target - entry) / risk).toFixed(2);
  };

  const computeRisk = (plan) => {
    const { planned_entry_price: entry, planned_stop_loss: stop, planned_quantity: qty } = plan;
    if (entry == null || stop == null || qty == null) return null;
    return (stop - entry) * qty;
  };

  const computeReward = (plan) => {
    const { planned_entry_price: entry, planned_target_price: target, planned_quantity: qty } = plan;
    if (entry == null || target == null || qty == null) return null;
    return (target - entry) * qty;
  };

  const fmtPnl = (n) => {
    if (n == null) return 'N/A';
    const abs = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return (n >= 0 ? '+$' : '-$') + abs;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-5 h-5 border-2 border-gray-200 border-t-blue-600 rounded-full animate-spin" />
      </div>
    );
  }

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

      {plans.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 px-5 py-16 text-center">
          <p className="text-sm font-medium text-gray-500 mb-1">No plans yet</p>
          <p className="text-xs text-gray-400">Tap "New plan" to document your next trade setup</p>
        </div>
      ) : (
        <div className="space-y-4">
          {plans.map((plan) => {
            const dir = (plan.direction || '').toLowerCase();
            const status = (plan.status || 'planned').toLowerCase();
            const rr = computeRR(plan);
            const risk = computeRisk(plan);
            const reward = computeReward(plan);
            const qty = plan.planned_quantity;

            return (
              <div key={plan.id} className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <div className="flex items-center space-x-3 mb-1">
                      <span className="text-xl font-semibold text-gray-900">{plan.symbol}</span>
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                        dir === 'long' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'
                      }`}>
                        {dir.toUpperCase()}
                      </span>
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${statusStyles[status] || 'bg-gray-100 text-gray-500'}`}>
                        {status.toUpperCase()}
                      </span>
                    </div>
                    <p className="text-xs text-gray-400">
                      {fmtDate(plan.created_at)}
                      {qty != null && <> &middot; {qty} {plan.asset_category === 'OPT' ? 'contracts' : 'shares'}</>}
                      {rr != null && <> &middot; R:R {rr}</>}
                    </p>
                  </div>
                </div>
                <div className="grid grid-cols-3 sm:grid-cols-6 gap-3 mb-4">
                  {[
                    { label: 'Entry', value: fmtPrice(plan.planned_entry_price) },
                    { label: 'Target', value: fmtPrice(plan.planned_target_price), color: 'text-green-600' },
                    { label: 'Stop', value: fmtPrice(plan.planned_stop_loss), color: 'text-red-500' },
                    { label: 'Risk', value: fmtPnl(risk), color: 'text-red-500' },
                    { label: 'Reward', value: fmtPnl(reward), color: 'text-green-600' },
                    { label: 'R:R', value: rr ?? 'N/A', color: 'text-blue-600' },
                  ].map(f => (
                    <div key={f.label} className="text-center bg-gray-50 rounded-lg py-2">
                      <p className="text-xs text-gray-400 mb-1">{f.label}</p>
                      <p className={`text-sm font-medium ${f.color || ''}`}>{f.value}</p>
                    </div>
                  ))}
                </div>
                {(plan.notes || plan.thesis) && (
                  <p className="text-sm text-gray-500 italic">{plan.notes ?? plan.thesis}</p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../lib/supabaseClient';
import { fmtPrice, fmtPnl, fmtDateLong } from '../lib/formatters';
import { useBaseCurrency } from '../lib/BaseCurrencyContext';
import PrivacyValue from '../components/PrivacyValue';

const statusStyles = {
  planned: 'bg-blue-50 text-blue-600',
  matched: 'bg-green-50 text-green-700',
  active: 'bg-blue-50 text-blue-600',
};

export default function PlansScreen({ session, onNewPlan, onEditPlan, refreshKey }) {
  // TODO: planned_trades has no 'currency' column. Once added, use plan.currency
  // for prices/risk/reward instead of baseCurrency. For now baseCurrency is the
  // best available fallback — at least it shows the user's own symbol, not '$'.
  const baseCurrency = useBaseCurrency();
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [dirFilter, setDirFilter] = useState('All');

  const userId = session?.user?.id;
  useEffect(() => {
    if (!userId) return;
    const load = async () => {
      const { data } = await supabase
        .from('planned_trades')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });
      setPlans(data || []);
      setLoading(false);
    };
    load();
  }, [userId, refreshKey]);

  const filtered = useMemo(() => {
    const q = search.trim().toUpperCase();
    return plans.filter(p => {
      if (q && !(p.symbol || '').toUpperCase().includes(q)) return false;
      if (dirFilter !== 'All' && (p.direction || '').toUpperCase() !== dirFilter) return false;
      return true;
    });
  }, [plans, search, dirFilter]);

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

  if (loading) {
    return (
      <div className="animate-pulse">
        <div className="flex items-center justify-between mb-6">
          <div className="h-7 bg-gray-200 rounded w-16" />
          <div className="h-9 bg-gray-200 rounded-lg w-24" />
        </div>
        {[...Array(3)].map((_, i) => (
          <div key={i} className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 mb-4">
            <div className="flex items-center space-x-3 mb-4">
              <div className="h-6 bg-gray-200 rounded w-16" />
              <div className="h-5 bg-gray-200 rounded-full w-12" />
              <div className="h-5 bg-gray-200 rounded-full w-16" />
            </div>
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
              {[...Array(6)].map((_, j) => (
                <div key={j} className="h-12 bg-gray-100 rounded-lg" />
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
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

      {/* Search + filter */}
      {plans.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 mb-5">
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by symbol…"
            className="text-sm px-3 py-1.5 rounded-lg border border-gray-200 bg-white focus:outline-none focus:ring-2 focus:ring-blue-400 w-48"
          />
          {['All', 'LONG', 'SHORT'].map(d => (
            <button
              key={d}
              onClick={() => setDirFilter(d)}
              className={`text-xs font-medium px-3 py-1.5 rounded-full border transition-colors ${
                dirFilter === d
                  ? 'bg-blue-600 text-white border-transparent'
                  : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
              }`}
            >
              {d === 'All' ? 'All' : d === 'LONG' ? 'Long' : 'Short'}
            </button>
          ))}
          {(search || dirFilter !== 'All') && (
            <span className="text-xs text-gray-400">{filtered.length} of {plans.length}</span>
          )}
        </div>
      )}

      {plans.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 px-5 py-16 text-center">
          <p className="text-sm font-medium text-gray-500 mb-1">No plans yet</p>
          <p className="text-xs text-gray-400">Tap "New plan" to document your next trade setup</p>
        </div>
      ) : (
        <div className="space-y-4">
          {filtered.length === 0 && plans.length > 0 ? (
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 px-5 py-12 text-center">
              <p className="text-sm text-gray-500">No plans match your search</p>
            </div>
          ) : null}
          {filtered.map((plan) => {
            const dir = (plan.direction || '').toLowerCase();
            const status = (plan.status || 'planned').toLowerCase();
            const rr = computeRR(plan);
            const risk = computeRisk(plan);
            const reward = computeReward(plan);
            const qty = plan.planned_quantity;

            return (
              <div key={plan.id} onClick={() => onEditPlan?.(plan)} className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 cursor-pointer hover:border-blue-200 hover:shadow-md transition-all">
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
                      {fmtDateLong(plan.created_at)}
                      {qty != null && <> &middot; <PrivacyValue value={qty} /> {plan.asset_category === 'OPT' ? 'contracts' : 'shares'}</>}
                      {rr != null && <> &middot; R:R {rr}</>}
                    </p>
                  </div>
                </div>
                <div className="grid grid-cols-3 sm:grid-cols-6 gap-3 mb-4">
                  {[
                    { label: 'Entry', value: fmtPrice(plan.planned_entry_price, plan.currency || baseCurrency), mask: false },
                    { label: 'Target', value: fmtPrice(plan.planned_target_price, plan.currency || baseCurrency), color: 'text-green-600', mask: false },
                    { label: 'Stop', value: fmtPrice(plan.planned_stop_loss, plan.currency || baseCurrency), color: 'text-red-500', mask: false },
                    { label: 'Risk', value: fmtPnl(risk, plan.currency || baseCurrency), color: 'text-red-500', mask: true },
                    { label: 'Reward', value: fmtPnl(reward, plan.currency || baseCurrency), color: 'text-green-600', mask: true },
                    { label: 'R:R', value: rr ?? 'N/A', color: 'text-blue-600', mask: false },
                  ].map(f => (
                    <div key={f.label} className="text-center bg-gray-50 rounded-lg py-2">
                      <p className="text-xs text-gray-400 mb-1">{f.label}</p>
                      <p className={`text-sm font-medium ${f.color || ''}`}>
                        {f.mask ? <PrivacyValue value={f.value} /> : f.value}
                      </p>
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

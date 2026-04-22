import React, { useState, useEffect, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import * as Sentry from '@sentry/react';
import { supabase } from '../lib/supabaseClient';
import { fmtPrice, fmtPnl, fmtDate, fmtDateLong, fmtSymbol } from '../lib/formatters';
import { useBaseCurrency } from '../lib/BaseCurrencyContext';
import { useDataVersion, useInitialLoadTracker } from '../lib/DataVersionContext';
import PrivacyValue from '../components/PrivacyValue';
import LoadError from '../components/LoadError';

const statusStyles = {
  planned: 'bg-blue-50 text-blue-600',
  matched: 'bg-green-50 text-green-700',
  active: 'bg-blue-50 text-blue-600',
};

export default function PlansScreen({ session, onNewPlan, onEditPlan, refreshKey }) {
  // baseCurrency is the fallback when a plan row has no native currency set
  // (can happen for plans created before a security was looked up and
  // currency-tagged). Plan cards render as: fmtPrice(..., plan.currency || baseCurrency).
  const baseCurrency = useBaseCurrency();
  const location = useLocation();
  const navigate = useNavigate();
  const [plans, setPlans] = useState([]);
  // Map<plan.id, Array<{ symbol, opened_at }>> — trades each plan is matched to.
  // Used to (1) hide matched plans from the default "Planning" view, (2) show
  // a "matched with X on Y" line on the card when the user toggles to Matched.
  const [matchedByPlan, setMatchedByPlan] = useState({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  // Bump to force the load useEffect to re-run (retry button).
  const [reloadKey, setReloadKey] = useState(0);
  const [search, setSearch] = useState('');
  const [dirFilter, setDirFilter] = useState('All');
  // Two-state toggle: the Plans screen is primarily the user's "what am I still
  // planning" workspace, so matched plans are hidden by default. Flipping to
  // 'matched' shows only the matched ones (read-only).
  const [matchView, setMatchView] = useState('planning');

  const userId = session?.user?.id;

  // Cross-screen data invalidation — refetch silently when watched tables
  // are mutated elsewhere. See lib/DataVersionContext for the key map.
  const [plansV, playbooksV] = useDataVersion('plans', 'playbooks');
  const loadTracker = useInitialLoadTracker(reloadKey);

  useEffect(() => {
    if (!userId) return;
    const isInitial = loadTracker.isInitial;
    if (isInitial) setLoading(true);
    setLoadError(null);
    const load = async () => {
      try {
        const [plansRes, matchedRes] = await Promise.all([
          supabase
            .from('planned_trades')
            .select('*')
            .eq('user_id', userId)
            .order('created_at', { ascending: false }),
          supabase
            .from('logical_trades')
            .select('planned_trade_id, symbol, opened_at, asset_category')
            .eq('user_id', userId)
            .not('planned_trade_id', 'is', null)
            .order('opened_at', { ascending: false }),
        ]);
        // Supabase returns error as a field on the resolved response — surface
        // it explicitly so we don't render an empty list on a half-failed load.
        if (plansRes.error) throw plansRes.error;
        if (matchedRes.error) throw matchedRes.error;
        setPlans(plansRes.data || []);
        const byPlan = {};
        for (const row of (matchedRes.data || [])) {
          if (!byPlan[row.planned_trade_id]) byPlan[row.planned_trade_id] = [];
          byPlan[row.planned_trade_id].push({ symbol: row.symbol, opened_at: row.opened_at, asset_category: row.asset_category });
        }
        setMatchedByPlan(byPlan);
      } catch (err) {
        console.error('[plans] load failed:', err?.message || err);
        Sentry.withScope((scope) => {
          scope.setTag('screen', 'plans');
          scope.setTag('step', 'load');
          scope.setTag('load_kind', isInitial ? 'initial' : 'silent-refetch');
          Sentry.captureException(err instanceof Error ? err : new Error(String(err)));
        });
        if (isInitial) setLoadError(err?.message || 'Could not load plans.');
      } finally {
        if (isInitial) setLoading(false);
        loadTracker.markLoaded();
      }
    };
    load();
  }, [userId, refreshKey, reloadKey, plansV, playbooksV]); // eslint-disable-line react-hooks/exhaustive-deps

  // Deep-link: HomeScreen's active-plan rows navigate here with
  // `state.openPlanId`. Once plans have loaded, find that plan and open
  // its edit sheet. Clear state so a browser refresh doesn't re-open it.
  useEffect(() => {
    const openId = location.state?.openPlanId;
    if (openId == null || loading) return;
    const target = plans.find(p => p.id === openId);
    if (target) onEditPlan?.(target);
    navigate(location.pathname, { replace: true, state: {} });
  }, [location.state, location.pathname, loading, plans, onEditPlan, navigate]);

  const filtered = useMemo(() => {
    const q = search.trim().toUpperCase();
    return plans.filter(p => {
      const isMatched = (matchedByPlan[p.id]?.length || 0) > 0;
      if (matchView === 'planning' && isMatched) return false;
      if (matchView === 'matched' && !isMatched) return false;
      if (q && !(p.symbol || '').toUpperCase().includes(q)) return false;
      if (dirFilter !== 'All' && (p.direction || '').toUpperCase() !== dirFilter) return false;
      return true;
    });
  }, [plans, search, dirFilter, matchView, matchedByPlan]);

  const matchedPlanCount = useMemo(
    () => plans.filter(p => (matchedByPlan[p.id]?.length || 0) > 0).length,
    [plans, matchedByPlan],
  );

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

  if (loadError) {
    return (
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold text-gray-900">Plans</h2>
        </div>
        <LoadError title="Could not load plans" message={loadError} onRetry={() => setReloadKey(k => k + 1)} />
      </div>
    );
  }

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
        <div className="flex items-center gap-2 mb-5 overflow-x-auto">
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search symbol…"
            className="text-sm px-3 py-1.5 rounded-lg border border-gray-200 bg-white focus:outline-none focus:ring-2 focus:ring-blue-400 w-36 shrink-0"
          />
          <button
            onClick={() => setMatchView(v => v === 'planning' ? 'matched' : 'planning')}
            className={`text-xs font-medium px-3 py-1.5 rounded-full border transition-colors shrink-0 ${
              matchView === 'matched'
                ? 'bg-gray-800 text-white border-transparent'
                : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
            }`}
            title={matchView === 'planning' ? 'Show matched plans (read-only)' : 'Back to active planning plans'}
          >
            {matchView === 'planning' ? `Matched (${matchedPlanCount})` : 'Planning'}
          </button>
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
            const matchedTrades = matchedByPlan[plan.id] || [];
            const locked = matchedTrades.length > 0;

            return (
              <div
                key={plan.id}
                onClick={locked ? undefined : () => onEditPlan?.(plan)}
                className={`bg-white rounded-xl shadow-sm border border-gray-100 p-5 transition-all ${
                  locked
                    ? ''
                    : 'cursor-pointer hover:border-blue-200 hover:shadow-md'
                }`}
              >
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
                    {locked && (
                      <p className="text-xs text-gray-500 mt-1.5 inline-flex items-center gap-1">
                        <span aria-hidden>🔒</span>
                        <span>
                          Matched with {fmtSymbol(matchedTrades[0])} from {fmtDate(matchedTrades[0].opened_at)}
                          {matchedTrades.length > 1 && ` +${matchedTrades.length - 1} more`} — cannot be edited
                        </span>
                      </p>
                    )}
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

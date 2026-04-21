import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import * as Sentry from '@sentry/react';
import { supabase } from '../lib/supabaseClient';
import { fmtPnl, fmtPrice, fmtSymbol, pnlBase } from '../lib/formatters';
import { useBaseCurrency } from '../lib/BaseCurrencyContext';
import PrivacyValue from '../components/PrivacyValue';
import LoadError from '../components/LoadError';
import TradeSquares from '../components/TradeSquares';

const todayStr = () => new Date().toISOString().slice(0, 10);

const thirtyDaysAgo = () => {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return d.toISOString();
};

const PAGE_SIZE = 10;

export default function HomeScreen({ session }) {
  const navigate = useNavigate();
  const userId = session?.user?.id;
  const baseCurrency = useBaseCurrency();
  const [positions, setPositions] = useState([]);
  const [plans, setPlans] = useState([]);
  const [matchedPlanIds, setMatchedPlanIds] = useState(() => new Set());
  const [logicalTrades, setLogicalTrades] = useState([]);
  const [pipelineTrades, setPipelineTrades] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);
  // Open positions sort: by unrealized P&L magnitude (biggest movers first).
  // Previously had Size / Date sort pills; removed per UX feedback.
  // Inline expand: default to top PAGE_SIZE, user can toggle to see all.
  const [showAllPositions, setShowAllPositions] = useState(false);

  useEffect(() => {
    if (!userId) return;
    setLoading(true);
    setLoadError(null);
    const load = async () => {
      try {
        const [posRes, plansRes, tradesRes, pipelineRes, matchedRes] = await Promise.all([
          supabase.from('open_positions').select('*').eq('user_id', userId),
          supabase.from('planned_trades').select('*').eq('user_id', userId),
          // 30-day window for KPI stats (today's P&L, win rate)
          supabase
            .from('logical_trades')
            .select('status, total_realized_pnl, fx_rate_to_base, closed_at, matching_status, direction, currency')
            .eq('user_id', userId)
            .gte('closed_at', thirtyDaysAgo()),
          // ALL-TIME pipeline counts — lightweight (only the fields we need for
          // bucket computation). No date filter: a user who hasn't logged in for
          // 5 days should see ALL pending trades, not just last 30 days.
          supabase
            .from('logical_trades')
            .select('id, matching_status, planned_trade_id, review_notes')
            .eq('user_id', userId)
            .eq('status', 'closed'),
          // Which plans already have a trade (closed OR open) matched to them.
          // Used to filter matched plans out of "Active plans" — a plan that's
          // been executed isn't active planning any more. Cheap: one column,
          // indexed, server-side filter on non-null planned_trade_id.
          supabase
            .from('logical_trades')
            .select('planned_trade_id')
            .eq('user_id', userId)
            .not('planned_trade_id', 'is', null),
        ]);
        if (posRes.error) throw posRes.error;
        if (plansRes.error) throw plansRes.error;
        if (tradesRes.error) throw tradesRes.error;
        if (pipelineRes.error) throw pipelineRes.error;
        if (matchedRes.error) throw matchedRes.error;
        setPositions(posRes.data || []);
        setPlans(plansRes.data || []);
        setLogicalTrades(tradesRes.data || []);
        setPipelineTrades(pipelineRes.data || []);
        const matchedIds = new Set();
        for (const row of (matchedRes.data || [])) {
          if (row.planned_trade_id != null) matchedIds.add(row.planned_trade_id);
        }
        setMatchedPlanIds(matchedIds);
      } catch (err) {
        console.error('[home] load failed:', err?.message || err);
        Sentry.withScope((scope) => {
          scope.setTag('screen', 'home');
          scope.setTag('step', 'load');
          Sentry.captureException(err instanceof Error ? err : new Error(String(err)));
        });
        setLoadError(err?.message || 'Could not load.');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [userId, reloadKey]);

  // Derived stats
  const today = todayStr();
  const todayTrades = logicalTrades.filter(t => t.closed_at?.slice(0, 10) === today);
  const todayPnl = todayTrades.reduce((sum, t) => sum + pnlBase(t), 0);

  // Sum unrealized P&L across currencies by converting each position to base.
  // `fx_rate_to_base` is captured per position at sync time (see api/sync.js
  // parseOpenPositions). Null fallback is 1.0 for legacy rows or single-currency
  // accounts where base = native.
  const totalUnrealized = positions.reduce(
    (sum, p) => sum + (p.unrealized_pnl || 0) * (p.fx_rate_to_base || 1),
    0
  );

  const closedLast30 = logicalTrades.filter(t => t.status === 'closed');
  const wins = closedLast30.filter(t => (t.total_realized_pnl || 0) > 0).length;
  const losses = closedLast30.filter(t => (t.total_realized_pnl || 0) <= 0).length;
  const winRate = closedLast30.length > 0 ? Math.round((wins / closedLast30.length) * 100) : null;

  // Trade review pipeline — all-time counts (not windowed).
  // A user who hasn't logged in for 5 days should see ALL pending trades.
  //
  // matching_status values and their pipeline bucket:
  //   'needs_review' → Need matching (2+ candidate plans, user must pick)
  //   'matched'      → Need notes (if no review_notes) or Fully done (if has notes)
  //   'off_plan'     → Need notes (if no review_notes) or Fully done (if has notes)
  const isUnresolved = (t) => t.matching_status === 'needs_review';
  const isResolved = (t) =>
    t.matching_status === 'matched' || t.matching_status === 'off_plan';

  const pipelineNeedMatching = pipelineTrades.filter(isUnresolved).length;
  const pipelineNeedNotes = pipelineTrades.filter(t => isResolved(t) && !t.review_notes).length;
  const pipelineFullyDone = pipelineTrades.filter(t => isResolved(t) && t.review_notes).length;
  const pipelineTotal = pipelineNeedMatching + pipelineNeedNotes + pipelineFullyDone;

  // Active plans = plans not yet linked to any logical_trade. Sorted by most
  // recently created so the newest idea is at the top.
  const unmatchedPlans = plans
    .filter(p => !matchedPlanIds.has(p.id))
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));

  // R:R = |target − entry| ÷ |entry − stop|. Returns a string with one
  // decimal ("1.7") or null if any leg is missing / risk is zero.
  const computeRR = (plan) => {
    const entry = plan.planned_entry_price;
    const target = plan.planned_target_price;
    const stop = plan.planned_stop_loss;
    if (entry == null || target == null || stop == null) return null;
    const risk = Math.abs(entry - stop);
    if (risk === 0) return null;
    return (Math.abs(target - entry) / risk).toFixed(1);
  };

  const statCards = [
    {
      label: "Today's P&L",
      value: todayTrades.length > 0 ? fmtPnl(todayPnl, baseCurrency) : '—',
      maskValue: todayTrades.length > 0,
      sub: todayTrades.length > 0 ? `${todayTrades.length} trade${todayTrades.length !== 1 ? 's' : ''} — tap to view` : 'No trades today',
      color: todayPnl >= 0 ? 'text-green-600' : 'text-red-500',
      onClick: () => navigate('/daily'),
    },
    {
      label: 'Open positions',
      value: String(positions.length),
      maskValue: false,
      sub: positions.length > 0 ? fmtPnl(totalUnrealized, baseCurrency) + ' unrealized' : 'No open positions',
      maskSub: positions.length > 0,
      color: 'text-blue-600',
      // Scroll to the positions section AND expand it so clicking the KPI
      // card reveals every position for users with more than PAGE_SIZE.
      onClick: () => {
        setShowAllPositions(true);
        setTimeout(() => {
          document.getElementById('open-positions')?.scrollIntoView({ behavior: 'smooth' });
        }, 0);
      },
    },
    {
      label: 'Active plans',
      value: String(unmatchedPlans.length),
      maskValue: false,
      sub: unmatchedPlans.length > 0 ? 'Ready to execute' : 'No plans yet',
      color: 'text-gray-900',
      onClick: () => navigate('/plans'),
    },
    {
      label: 'Win rate (30d)',
      value: winRate != null ? `${winRate}%` : '—',
      maskValue: false,
      sub: closedLast30.length > 0 ? `${wins}W · ${losses}L` : 'No closed trades',
      color: winRate != null && winRate >= 50 ? 'text-green-600' : 'text-red-500',
      onClick: () => navigate('/performance'),
    },
  ];

  if (loadError) {
    return (
      <div>
        <h2 className="text-xl font-semibold text-gray-900 mb-4">Home</h2>
        <LoadError title="Could not load your dashboard" message={loadError} onRetry={() => setReloadKey(k => k + 1)} />
      </div>
    );
  }

  if (loading) {
    return (
      <div className="animate-pulse">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
              <div className="h-3 bg-gray-200 rounded w-20 mb-3" />
              <div className="h-7 bg-gray-200 rounded w-24" />
            </div>
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
            <div className="h-4 bg-gray-200 rounded w-32 mb-4" />
            {[...Array(4)].map((_, i) => (
              <div key={i} className="flex justify-between py-3 border-b border-gray-50 last:border-0">
                <div className="h-4 bg-gray-200 rounded w-20" />
                <div className="h-4 bg-gray-200 rounded w-16" />
              </div>
            ))}
          </div>
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
            <div className="h-4 bg-gray-200 rounded w-24 mb-4" />
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-24 bg-gray-100 rounded-xl mb-3 last:mb-0" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* ── TradeSquares (discipline heatmap) ──
          Sits at the very top of the dashboard as the hook. Reads from the
          daily_adherence table populated by api/rebuild.js. Fully self-
          contained — loads, renders, handles its own errors. */}
      <TradeSquares userId={userId} />

      {/* ── Trade review pipeline ── */}
      {pipelineTotal > 0 && (
        <div className="bg-white border border-gray-100 rounded-xl shadow-sm p-5 mb-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-semibold text-gray-700">Trade review pipeline</h3>
              <p className="text-xs text-gray-400 mt-0.5">{pipelineTotal} closed trade{pipelineTotal !== 1 ? 's' : ''}</p>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            {/* 1. Need matching */}
            <button
              onClick={() => navigate('/review')}
              disabled={pipelineNeedMatching === 0}
              className={`group text-left rounded-xl border p-4 transition-colors ${
                pipelineNeedMatching > 0
                  ? 'border-amber-200 bg-amber-50 hover:bg-amber-100 cursor-pointer'
                  : 'border-gray-100 bg-gray-50 cursor-default opacity-60'
              }`}
            >
              <p className={`text-2xl font-semibold mb-0.5 ${pipelineNeedMatching > 0 ? 'text-amber-700' : 'text-gray-400'}`}>
                {pipelineNeedMatching}
              </p>
              <p className={`text-xs font-semibold ${pipelineNeedMatching > 0 ? 'text-amber-700' : 'text-gray-400'}`}>
                Need matching
              </p>
              <p className={`text-[11px] mt-1 ${pipelineNeedMatching > 0 ? 'text-amber-600' : 'text-gray-400'}`}>
                {pipelineNeedMatching > 0 ? 'Link to a plan →' : 'All matched'}
              </p>
            </button>

            {/* 2. Need notes */}
            <button
              onClick={() => navigate('/journal', { state: { activeFilter: 'Not journalled' } })}
              disabled={pipelineNeedNotes === 0}
              className={`group text-left rounded-xl border p-4 transition-colors ${
                pipelineNeedNotes > 0
                  ? 'border-blue-200 bg-blue-50 hover:bg-blue-100 cursor-pointer'
                  : 'border-gray-100 bg-gray-50 cursor-default opacity-60'
              }`}
            >
              <p className={`text-2xl font-semibold mb-0.5 ${pipelineNeedNotes > 0 ? 'text-blue-700' : 'text-gray-400'}`}>
                {pipelineNeedNotes}
              </p>
              <p className={`text-xs font-semibold ${pipelineNeedNotes > 0 ? 'text-blue-700' : 'text-gray-400'}`}>
                Need notes
              </p>
              <p className={`text-[11px] mt-1 ${pipelineNeedNotes > 0 ? 'text-blue-600' : 'text-gray-400'}`}>
                {pipelineNeedNotes > 0 ? 'Journal →' : 'All journalled'}
              </p>
            </button>

            {/* 3. Fully done */}
            <button
              onClick={() => navigate('/journal', { state: { activeFilter: 'Fully done' } })}
              className="text-left rounded-xl border border-green-200 bg-green-50 p-4 hover:bg-green-100 transition-colors cursor-pointer"
            >
              <p className="text-2xl font-semibold text-green-700 mb-0.5">{pipelineFullyDone}</p>
              <p className="text-xs font-semibold text-green-700">Fully done</p>
              <p className="text-[11px] text-green-600 mt-1">View all →</p>
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {statCards.map(card => (
          <div
            key={card.label}
            onClick={card.onClick || undefined}
            className={`bg-white rounded-xl p-4 shadow-sm border border-gray-100 ${
              card.onClick ? 'cursor-pointer hover:border-blue-200 hover:shadow-md transition-all' : ''
            }`}
          >
            <p className="text-xs font-medium text-gray-400 mb-1">{card.label}</p>
            <p className={`text-2xl font-semibold ${card.color}`}>
              {card.maskValue ? <PrivacyValue value={card.value} /> : card.value}
            </p>
            <p className="text-xs text-gray-400 mt-1">
              {card.maskSub ? <PrivacyValue value={card.sub} /> : card.sub}
            </p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div id="open-positions">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-gray-700">Open positions</h3>
          </div>
          {positions.length === 0 ? (
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 px-5 py-8 text-center">
              <p className="text-sm text-gray-400">No open positions</p>
            </div>
          ) : (() => {
            // Sort by unrealized-P&L magnitude (biggest movers first).
            // Default render: top PAGE_SIZE. User can click "Show all" to
            // expand inline for pro traders with many positions. No navigation
            // -- open positions are informational, there's nowhere to drill.
            const sorted = [...positions].sort((a, b) =>
              Math.abs(b.unrealized_pnl || 0) - Math.abs(a.unrealized_pnl || 0)
            );
            const visible = showAllPositions ? sorted : sorted.slice(0, PAGE_SIZE);
            const hasMore = positions.length > PAGE_SIZE;
            return (
              <>
                <div className="bg-white rounded-xl shadow-sm border border-gray-100">
                  {/* Column header so the right-hand number is clearly labeled */}
                  <div className="flex items-center justify-between px-5 py-2 border-b border-gray-100 bg-gray-50 rounded-t-xl">
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Position</p>
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Unrealized P&amp;L</p>
                  </div>
                  <div className="divide-y divide-gray-50">
                    {visible.map(pos => {
                      const isLong = (pos.position || 0) >= 0;
                      const qty = Math.abs(pos.position || 0);
                      const pnl = pos.unrealized_pnl || 0;
                      return (
                        <div key={pos.id || pos.symbol} className="flex items-center justify-between px-5 py-3">
                          <div>
                            <p className="font-semibold text-gray-900">{fmtSymbol(pos)}</p>
                            <p className="text-xs text-gray-400 mt-0.5">
                              {isLong ? 'Long' : 'Short'} &middot; <PrivacyValue value={qty} /> {pos.asset_category === 'STK' ? 'shares' : pos.asset_category === 'OPT' ? 'contracts' : 'units'}
                            </p>
                          </div>
                          <div className="text-right">
                            <p className={`font-semibold ${pnl >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                              <PrivacyValue value={fmtPnl(pnl, pos.currency)} />
                            </p>
                            <p className="text-xs text-gray-400 mt-0.5">
                              avg cost {fmtPrice(pos.avg_cost, pos.currency)}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
                {hasMore && (
                  <button
                    onClick={() => setShowAllPositions(v => !v)}
                    className="mt-2 text-xs text-blue-600 font-medium hover:underline w-full text-center py-1"
                  >
                    {showAllPositions
                      ? 'Show less ↑'
                      : `Show all ${positions.length} positions ↓`}
                  </button>
                )}
              </>
            );
          })()}
        </div>

        <div>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-gray-700">Active plans</h3>
            <button onClick={() => navigate('/plans')} className="text-xs text-blue-600 font-medium hover:underline">View all &rarr;</button>
          </div>
          {unmatchedPlans.length === 0 ? (
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 px-5 py-8 text-center">
              <p className="text-sm text-gray-400">No active plans</p>
            </div>
          ) : (
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 divide-y divide-gray-50 overflow-hidden">
              {unmatchedPlans.map(plan => {
                const dir = (plan.direction || '').toLowerCase();
                const rr = computeRR(plan);
                const currency = plan.currency || baseCurrency;
                const rrColor = rr == null ? 'text-gray-300'
                  : parseFloat(rr) >= 2 ? 'text-green-600'
                  : parseFloat(rr) >= 1 ? 'text-amber-500'
                  : 'text-red-500';
                return (
                  <button
                    key={plan.id}
                    onClick={() => navigate('/plans', { state: { openPlanId: plan.id } })}
                    className="w-full px-4 py-3 flex items-center gap-3 hover:bg-gray-50 transition-colors text-left"
                  >
                    <span className="font-semibold text-gray-900 w-16 shrink-0">{plan.symbol}</span>
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full shrink-0 ${
                      dir === 'long' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'
                    }`}>
                      {dir.toUpperCase()}
                    </span>
                    <span className="text-sm text-gray-600 flex-1 truncate">
                      {fmtPrice(plan.planned_entry_price, currency)}
                      <span className="text-gray-300 mx-1.5">→</span>
                      <span className="text-green-600">{fmtPrice(plan.planned_target_price, currency)}</span>
                    </span>
                    <span className={`text-xs font-semibold shrink-0 ${rrColor}`}>
                      {rr != null ? `${rr}R` : '—'}
                    </span>
                    <svg className="w-4 h-4 text-gray-300 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}


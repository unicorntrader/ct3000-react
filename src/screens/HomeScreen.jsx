import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabaseClient';
import { fmtPnl, fmtPrice, pnlBase } from '../lib/formatters';
import { useBaseCurrency } from '../lib/BaseCurrencyContext';
import PrivacyValue from '../components/PrivacyValue';

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
  const [logicalTrades, setLogicalTrades] = useState([]);
  const [pipelineTrades, setPipelineTrades] = useState([]);
  const [loading, setLoading] = useState(true);
  const [posSort, setPosSort] = useState('size'); // 'size' | 'date'

  useEffect(() => {
    if (!userId) return;
    const load = async () => {
      const [posRes, plansRes, tradesRes, pipelineRes] = await Promise.all([
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
      ]);
      setPositions(posRes.data || []);
      setPlans(plansRes.data || []);
      setLogicalTrades(tradesRes.data || []);
      setPipelineTrades(pipelineRes.data || []);
      setLoading(false);
    };
    load();
  }, [userId]);

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
  const pipelineNeedMatching = pipelineTrades.filter(
    t => t.matching_status === 'unmatched' || t.matching_status === 'ambiguous'
  ).length;
  const pipelineNeedNotes = pipelineTrades.filter(
    t => (t.matching_status === 'matched' || t.matching_status === 'manual') && !t.review_notes
  ).length;
  const pipelineFullyDone = pipelineTrades.filter(
    t => (t.matching_status === 'matched' || t.matching_status === 'manual') && t.review_notes
  ).length;
  const pipelineTotal = pipelineNeedMatching + pipelineNeedNotes + pipelineFullyDone;

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
      onClick: () => document.getElementById('open-positions')?.scrollIntoView({ behavior: 'smooth' }),
    },
    {
      label: 'Active plans',
      value: String(plans.length),
      maskValue: false,
      sub: plans.length > 0 ? 'Ready to execute' : 'No plans yet',
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
              onClick={() => navigate('/journal')}
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
            {positions.length > 0 && (
              <div className="flex items-center space-x-2">
                <span className="text-xs text-gray-400">Sort:</span>
                <button
                  onClick={() => setPosSort('size')}
                  className={`text-xs font-medium px-2.5 py-1 rounded-full border transition-colors ${
                    posSort === 'size' ? 'bg-blue-600 text-white border-transparent' : 'bg-white border-gray-200 text-gray-500 hover:bg-gray-50'
                  }`}
                >
                  Size
                </button>
                <button
                  onClick={() => setPosSort('date')}
                  className={`text-xs font-medium px-2.5 py-1 rounded-full border transition-colors ${
                    posSort === 'date' ? 'bg-blue-600 text-white border-transparent' : 'bg-white border-gray-200 text-gray-500 hover:bg-gray-50'
                  }`}
                >
                  Date
                </button>
              </div>
            )}
          </div>
          {positions.length === 0 ? (
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 px-5 py-8 text-center">
              <p className="text-sm text-gray-400">No open positions</p>
            </div>
          ) : (() => {
            const sorted = [...positions].sort((a, b) => {
              if (posSort === 'size') {
                const sizeA = Math.abs(a.market_value ?? (a.position * a.avg_cost) ?? 0);
                const sizeB = Math.abs(b.market_value ?? (b.position * b.avg_cost) ?? 0);
                return sizeB - sizeA;
              }
              // date: most recent updated_at first
              return new Date(b.updated_at || 0) - new Date(a.updated_at || 0);
            });
            const visible = sorted.slice(0, PAGE_SIZE);
            const overflow = positions.length > PAGE_SIZE;
            return (
              <>
                <div className="bg-white rounded-xl shadow-sm border border-gray-100 divide-y divide-gray-50">
                  {visible.map(pos => {
                    const isLong = (pos.position || 0) >= 0;
                    const qty = Math.abs(pos.position || 0);
                    const pnl = pos.unrealized_pnl || 0;
                    return (
                      <div key={pos.id || pos.symbol} className="flex items-center justify-between px-5 py-3">
                        <div>
                          <p className="font-semibold text-gray-900">{pos.symbol}</p>
                          <p className="text-xs text-gray-400 mt-0.5">
                            {isLong ? 'Long' : 'Short'} &middot; <PrivacyValue value={qty} /> {pos.asset_category === 'STK' ? 'shares' : pos.asset_category === 'OPT' ? 'contracts' : 'units'}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className={`font-semibold ${pnl >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                            <PrivacyValue value={fmtPnl(pnl, pos.currency)} />
                          </p>
                          <p className="text-xs text-gray-400 mt-0.5">
                            avg {fmtPrice(pos.avg_cost, pos.currency)}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
                {overflow && (
                  <button
                    onClick={() => navigate('/daily')}
                    className="mt-2 text-xs text-blue-600 font-medium hover:underline w-full text-center py-1"
                  >
                    View all {positions.length} positions &rarr;
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
          {plans.length === 0 ? (
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 px-5 py-8 text-center">
              <p className="text-sm text-gray-400">No active plans</p>
            </div>
          ) : (
            <div className="space-y-3">
              {plans.map(plan => {
                const dir = (plan.direction || '').toLowerCase();
                return (
                  <div key={plan.id} className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
                    <div className="flex items-center justify-between mb-3">
                      <span className="font-semibold text-gray-900">{plan.symbol}</span>
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                        dir === 'long' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'
                      }`}>
                        {dir.toUpperCase()}
                      </span>
                    </div>
                    <div className="grid grid-cols-3 gap-2 mb-2">
                      <div className="text-center bg-gray-50 rounded-lg py-1.5">
                        <p className="text-xs text-gray-400 mb-0.5">Entry</p>
                        <p className="text-sm font-medium">{fmtPrice(plan.planned_entry_price, plan.currency || baseCurrency)}</p>
                      </div>
                      <div className="text-center bg-gray-50 rounded-lg py-1.5">
                        <p className="text-xs text-gray-400 mb-0.5">Target</p>
                        <p className="text-sm font-medium text-green-600">{fmtPrice(plan.planned_target_price, plan.currency || baseCurrency)}</p>
                      </div>
                      <div className="text-center bg-gray-50 rounded-lg py-1.5">
                        <p className="text-xs text-gray-400 mb-0.5">Stop</p>
                        <p className="text-sm font-medium text-red-500">{fmtPrice(plan.planned_stop_loss, plan.currency || baseCurrency)}</p>
                      </div>
                    </div>
                    {plan.thesis && (
                      <p className="text-xs text-gray-500 italic">{plan.thesis}</p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabaseClient';
import { fmtPnl, fmtPrice, currencySymbol } from '../lib/formatters';
import PrivacyValue from '../components/PrivacyValue';

const todayStr = () => new Date().toISOString().slice(0, 10);

const thirtyDaysAgo = () => {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return d.toISOString();
};

const PAGE_SIZE = 10;

export default function HomeScreen({ session, onReviewOpen, reviewDismissed }) {
  const navigate = useNavigate();
  const [positions, setPositions] = useState([]);
  const [plans, setPlans] = useState([]);
  const [logicalTrades, setLogicalTrades] = useState([]);
  const [loading, setLoading] = useState(true);
  const [posSort, setPosSort] = useState('size'); // 'size' | 'date'

  useEffect(() => {
    if (!session?.user?.id) return;
    fetchData();
  }, [session]);

  const fetchData = async () => {
    const userId = session.user.id;
    const [posRes, plansRes, tradesRes] = await Promise.all([
      supabase.from('open_positions').select('*').eq('user_id', userId),
      supabase.from('planned_trades').select('*').eq('user_id', userId),
      supabase
        .from('logical_trades')
        .select('status, total_realized_pnl, closed_at, matching_status, direction, currency')
        .eq('user_id', userId)
        .gte('closed_at', thirtyDaysAgo()),
    ]);

    setPositions(posRes.data || []);
    setPlans(plansRes.data || []);
    setLogicalTrades(tradesRes.data || []);
    setLoading(false);
  };

  // Derived stats
  const today = todayStr();
  const todayTrades = logicalTrades.filter(t => t.closed_at?.slice(0, 10) === today);
  const todayPnl = todayTrades.reduce((sum, t) => sum + (t.total_realized_pnl || 0), 0);

  const totalUnrealized = positions.reduce((sum, p) => sum + (p.unrealized_pnl || 0), 0);

  const closedLast30 = logicalTrades.filter(t => t.status === 'closed');
  const wins = closedLast30.filter(t => (t.total_realized_pnl || 0) > 0).length;
  const losses = closedLast30.filter(t => (t.total_realized_pnl || 0) <= 0).length;
  const winRate = closedLast30.length > 0 ? Math.round((wins / closedLast30.length) * 100) : null;

  const reviewCount = logicalTrades.filter(
    t => t.matching_status === 'unmatched' || t.matching_status === 'ambiguous'
  ).length;

  const statCards = [
    {
      label: "Today's P&L",
      value: todayTrades.length > 0 ? fmtPnl(todayPnl) : '—',
      maskValue: todayTrades.length > 0,
      sub: todayTrades.length > 0 ? `${todayTrades.length} trade${todayTrades.length !== 1 ? 's' : ''}` : 'No trades today',
      color: todayPnl >= 0 ? 'text-green-600' : 'text-red-500',
    },
    {
      label: 'Open positions',
      value: String(positions.length),
      maskValue: false,
      sub: positions.length > 0 ? fmtPnl(totalUnrealized) + ' unrealized' : 'No open positions',
      maskSub: positions.length > 0,
      color: 'text-blue-600',
    },
    {
      label: 'Active plans',
      value: String(plans.length),
      maskValue: false,
      sub: plans.length > 0 ? 'Ready to execute' : 'No plans yet',
      color: 'text-gray-900',
    },
    {
      label: 'Win rate (30d)',
      value: winRate != null ? `${winRate}%` : '—',
      maskValue: false,
      sub: closedLast30.length > 0 ? `${wins}W · ${losses}L` : 'No closed trades',
      color: winRate != null && winRate >= 50 ? 'text-green-600' : 'text-red-500',
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
      {!reviewDismissed && reviewCount > 0 && (
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
            <p className="text-sm font-medium text-amber-800">{reviewCount} trade{reviewCount !== 1 ? 's' : ''} need review</p>
            <p className="text-xs text-amber-600">Tap to review now -- takes about 2 minutes</p>
          </div>
          <svg className="w-4 h-4 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {statCards.map(card => (
          <div key={card.label} className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
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
        <div>
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
                            avg <PrivacyValue value={fmtPrice(pos.avg_cost, pos.currency)} /> &middot; <span className="text-gray-300">at last sync</span>
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
                        <p className="text-sm font-medium"><PrivacyValue value={fmtPrice(plan.planned_entry_price)} /></p>
                      </div>
                      <div className="text-center bg-gray-50 rounded-lg py-1.5">
                        <p className="text-xs text-gray-400 mb-0.5">Target</p>
                        <p className="text-sm font-medium text-green-600"><PrivacyValue value={fmtPrice(plan.planned_target_price)} /></p>
                      </div>
                      <div className="text-center bg-gray-50 rounded-lg py-1.5">
                        <p className="text-xs text-gray-400 mb-0.5">Stop</p>
                        <p className="text-sm font-medium text-red-500"><PrivacyValue value={fmtPrice(plan.planned_stop_loss)} /></p>
                      </div>
                    </div>
                    {(plan.notes || plan.thesis) && (
                      <p className="text-xs text-gray-500 italic">{plan.notes ?? plan.thesis}</p>
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

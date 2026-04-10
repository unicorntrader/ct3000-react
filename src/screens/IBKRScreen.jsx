import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabaseClient';

export default function IBKRScreen({ session }) {
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [token, setToken] = useState('');
  const [queryId, setQueryId] = useState('');
  const [maskedToken, setMaskedToken] = useState('');
  const [maskedQueryId, setMaskedQueryId] = useState('');
  const [lastSyncAt, setLastSyncAt] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState(null);
  const [syncError, setSyncError] = useState(null);
  const [saveError, setSaveError] = useState(null);

  useEffect(() => {
    if (!session?.user?.id) return;
    loadCredentials();
  }, [session]);

  const loadCredentials = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('user_ibkr_credentials')
      .select('token_masked, query_id_masked, last_sync_at')
      .eq('user_id', session.user.id)
      .single();

    if (data && !error) {
      setConnected(true);
      setMaskedToken(data.token_masked || '');
      setMaskedQueryId(data.query_id_masked || '');
      setLastSyncAt(data.last_sync_at);
    } else {
      setConnected(false);
    }
    setLoading(false);
  };

  const handleSaveCredentials = async () => {
    if (!token || !queryId) {
      setSaveError('Please enter both your token and Query ID.');
      return;
    }
    setSaving(true);
    setSaveError(null);

    const tokenMasked = '•'.repeat(token.length - 4) + token.slice(-4);
    const queryIdMasked = '•'.repeat(Math.max(0, queryId.length - 2)) + queryId.slice(-2);

    const { error } = await supabase
      .from('user_ibkr_credentials')
      .upsert({
        user_id: session.user.id,
        ibkr_token: token,
        query_id_30d: queryId,
        token_masked: tokenMasked,
        query_id_masked: queryIdMasked,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' });

    if (error) {
      setSaveError(error.message);
    } else {
      setConnected(true);
      setMaskedToken(tokenMasked);
      setMaskedQueryId(queryIdMasked);
      setToken('');
      setQueryId('');
    }
    setSaving(false);
  };

  const handleRemove = async () => {
    const { error } = await supabase
      .from('user_ibkr_credentials')
      .delete()
      .eq('user_id', session.user.id);

    if (!error) {
      setConnected(false);
      setMaskedToken('');
      setMaskedQueryId('');
      setSyncResult(null);
      setSyncError(null);
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    setSyncResult(null);
    setSyncError(null);
    try {
      // Step 1: Get credentials
      const { data: creds, error: credsError } = await supabase
        .from('user_ibkr_credentials')
        .select('ibkr_token, query_id_30d')
        .eq('user_id', session.user.id)
        .single();

      if (credsError || !creds) {
        setSyncError('Could not load IBKR credentials. Please reconnect.');
        return;
      }

      // Step 2: Fetch from IBKR
      const res = await fetch(`/api/sync?token=${creds.ibkr_token}&queryId=${creds.query_id_30d}`);
      const result = await res.json();

      if (!result.success) {
        setSyncError(result.error);
        return;
      }

      const userId = session.user.id;

      // Step 3: Upsert trades
      if (result.trades.length > 0) {
        const tradesToUpsert = result.trades
          .filter(t => t.ibExecID)
          .map(t => ({
            user_id:                userId,
            ib_exec_id:             t.ibExecID,
            ib_order_id:            t.ibOrderID,
            account_id:             t.accountId,
            conid:                  t.conid,
            symbol:                 t.symbol,
            asset_category:         t.assetCategory,
            buy_sell:               t.buySell,
            open_close_indicator:   t.openCloseIndicator,
            quantity:               t.quantity ? parseFloat(t.quantity) : null,
            trade_price:            t.tradePrice ? parseFloat(t.tradePrice) : null,
            date_time:              t.dateTime,
            net_cash:               t.netCash ? parseFloat(t.netCash) : null,
            fifo_pnl_realized:      t.fifoPnlRealized ? parseFloat(t.fifoPnlRealized) : null,
            ib_commission:          t.ibCommission ? parseFloat(t.ibCommission) : null,
            ib_commission_currency: t.ibCommissionCurrency,
            currency:               t.currency,
            fx_rate_to_base:        t.fxRateToBase ? parseFloat(t.fxRateToBase) : 1.0,
            transaction_type:       t.transactionType,
            notes:                  t.notes,
            multiplier:             t.multiplier ? parseFloat(t.multiplier) : null,
            strike:                 t.strike ? parseFloat(t.strike) : null,
            expiry:                 t.expiry,
            put_call:               t.putCall,
          }));

        const { error: tradesError } = await supabase
          .from('trades')
          .upsert(tradesToUpsert, { onConflict: 'user_id,ib_exec_id' });

        if (tradesError) {
          setSyncError(`Trades save failed: ${tradesError.message}`);
          return;
        }
      }

      // Step 4: Replace open positions
      await supabase.from('open_positions').delete().eq('user_id', userId);

      if (result.openPositions.length > 0) {
        const positionsToInsert = result.openPositions.map(p => ({
          user_id:        userId,
          account_id:     p.accountId,
          conid:          p.conid,
          symbol:         p.symbol,
          asset_category: p.assetCategory,
          position:       p.position ? parseFloat(p.position) : null,
          avg_cost:       p.avgCost ? parseFloat(p.avgCost) : null,
          market_value:   p.marketValue ? parseFloat(p.marketValue) : null,
          unrealized_pnl: p.unrealizedPnl ? parseFloat(p.unrealizedPnl) : null,
          currency:       p.currency,
          updated_at:     new Date().toISOString(),
        }));

        const { error: positionsError } = await supabase
          .from('open_positions')
          .insert(positionsToInsert);

        if (positionsError) {
          setSyncError(`Positions save failed: ${positionsError.message}`);
          return;
        }
      }

      // Step 5: Update last_sync_at and account_id
      const accountId = result.trades[0]?.accountId || result.openPositions[0]?.accountId;
      const now = new Date().toISOString();
      await supabase
        .from('user_ibkr_credentials')
        .update({
          last_sync_at: now,
          ...(accountId && { account_id: accountId }),
          ...(result.baseCurrency && { base_currency: result.baseCurrency }),
        })
        .eq('user_id', userId);

      setLastSyncAt(now);

      // Step 6: Build logical trades from raw trades
      const { data: allTrades, error: fetchError } = await supabase
        .from('trades')
        .select('*')
        .eq('user_id', userId)
        .order('date_time', { ascending: true });

      if (!fetchError && allTrades) {
        const { buildLogicalTrades } = await import('../lib/logicalTradeBuilder');
        const logical = buildLogicalTrades(allTrades, userId);

        if (logical.length > 0) {
          await supabase.from('logical_trades').delete().eq('user_id', userId);
          const { error: logicalError } = await supabase
            .from('logical_trades')
            .insert(logical);
          if (logicalError) {
            console.error('Logical trades save failed:', logicalError.message);
          } else {
            // Step 7: Run plan matcher
            const { data: savedLogical } = await supabase
              .from('logical_trades')
              .select('*')
              .eq('user_id', userId);

            const { data: plannedTrades } = await supabase
              .from('planned_trades')
              .select('*')
              .eq('user_id', userId);

            if (savedLogical && plannedTrades) {
              const { matchPlansToTrades } = await import('../lib/planMatcher');
              const matchUpdates = matchPlansToTrades(savedLogical, plannedTrades);

              for (const update of matchUpdates) {
                await supabase
                  .from('logical_trades')
                  .update({
                    matching_status: update.matching_status,
                    planned_trade_id: update.planned_trade_id,
                  })
                  .eq('id', update.id);
              }
            }
          }
        }
      }

      setSyncResult({
        tradeCount: result.trades.length,
        openPositionCount: result.openPositions.length,
      });

    } catch (err) {
      setSyncError(err.message);
    } finally {
      setSyncing(false);
    }
  };

  const handleTestSync = async () => {
    if (!token || !queryId) return;
    setSyncing(true);
    setSyncResult(null);
    setSyncError(null);
    try {
      const res = await fetch(`/api/sync?token=${token}&queryId=${queryId}`);
      const data = await res.json();
      if (data.success) {
        setSyncResult({ tradeCount: data.tradeCount, openPositionCount: data.openPositionCount });
      } else {
        setSyncError(data.error);
      }
    } catch (err) {
      setSyncError(err.message);
    } finally {
      setSyncing(false);
    }
  };

  const formatSyncTime = (ts) => {
    if (!ts) return 'Never';
    const d = new Date(ts);
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) + ' at ' +
      d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
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
      <h2 className="text-xl font-semibold text-gray-900 mb-6">Interactive Brokers</h2>

      {connected ? (
        <div className="space-y-4">
          <div className="bg-green-50 border border-green-200 rounded-xl p-4 flex items-center space-x-3">
            <div className="w-8 h-8 bg-green-100 rounded-full flex items-center justify-center flex-shrink-0">
              <svg className="w-4 h-4 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-medium text-green-800">IBKR account connected</p>
              <p className="text-xs text-green-600 mt-0.5">Last sync: {formatSyncTime(lastSyncAt)}</p>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-gray-100 divide-y divide-gray-50">
            <div className="px-5 py-4 flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-900">Flex Query token</p>
                <p className="text-xs text-gray-400 mt-0.5 font-mono">{maskedToken}</p>
              </div>
              <button onClick={handleRemove} className="text-xs text-red-500 font-medium hover:underline">
                Remove
              </button>
            </div>
            <div className="px-5 py-4 flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-900">Query ID</p>
                <p className="text-xs text-gray-400 mt-0.5 font-mono">{maskedQueryId}</p>
              </div>
              <button onClick={() => setConnected(false)} className="text-xs text-blue-600 font-medium hover:underline">
                Update
              </button>
            </div>
            <div className="px-5 py-4 flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-900">Auto-sync</p>
                <p className="text-xs text-gray-400 mt-0.5">Daily after US market close</p>
              </div>
              <label className="toggle">
                <input type="checkbox" defaultChecked />
                <span className="toggle-slider" />
              </label>
            </div>
          </div>

          <button
            onClick={handleSync}
            disabled={syncing}
            className="w-full bg-blue-600 text-white font-semibold py-3 rounded-xl text-sm hover:bg-blue-700 transition-colors disabled:opacity-50 flex items-center justify-center space-x-2"
          >
            <svg className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            <span>{syncing ? 'Syncing...' : 'Sync now'}</span>
          </button>

          {syncResult && (
            <div className="bg-green-50 border border-green-200 rounded-xl p-4">
              <p className="text-sm font-semibold text-green-800 mb-2">Sync successful</p>
              <p className="text-sm text-green-700">{syncResult.tradeCount} trades saved to database</p>
              <p className="text-sm text-green-700">{syncResult.openPositionCount} open positions updated</p>
            </div>
          )}

          {syncError && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-4">
              <p className="text-sm font-semibold text-red-800 mb-1">Sync failed</p>
              <p className="text-sm text-red-600">{syncError}</p>
            </div>
          )}
        </div>

      ) : (
        <div className="space-y-6">
          <div className="border-2 border-dashed border-gray-200 rounded-2xl p-8 text-center">
            <div className="w-14 h-14 bg-gray-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <svg className="w-7 h-7 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
            <h3 className="text-base font-semibold text-gray-900 mb-1">Connect Interactive Brokers</h3>
            <p className="text-sm text-gray-400">Enter your Flex Query credentials to start importing trades automatically</p>
          </div>

          <div className="bg-blue-50 border border-blue-100 rounded-xl p-4">
            <p className="text-xs font-semibold text-blue-800 mb-2">How to get your credentials:</p>
            <ol className="text-xs text-blue-700 space-y-1.5 list-decimal list-inside">
              <li>Log in to IBKR Client Portal</li>
              <li>Go to Performance &amp; Reports → Flex Queries</li>
              <li>Click Flex Web Service Configuration → enable &amp; copy your Token</li>
              <li>Create an Activity Flex Query → note the Query ID</li>
            </ol>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
                Flex Web Service Token <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                placeholder="e.g. 12345678901234567890123"
                value={token}
                onChange={e => setToken(e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-gray-50 font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
                Query ID <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                placeholder="e.g. 123456"
                value={queryId}
                onChange={e => setQueryId(e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-gray-50 font-mono"
              />
            </div>
            {saveError && (
              <div className="bg-red-50 border border-red-100 rounded-xl px-4 py-3 text-sm text-red-600">
                {saveError}
              </div>
            )}
          </div>

          <div className="flex gap-3">
            <button
              onClick={handleSaveCredentials}
              disabled={saving}
              className="flex-1 bg-blue-600 text-white font-semibold py-3 rounded-xl text-sm hover:bg-blue-700 transition-colors disabled:opacity-50 flex items-center justify-center space-x-2"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              <span>{saving ? 'Saving...' : 'Connect IBKR'}</span>
            </button>
            {token && queryId && (
              <button
                onClick={handleTestSync}
                disabled={syncing}
                className="border border-blue-200 text-blue-600 font-semibold py-3 px-4 rounded-xl text-sm hover:bg-blue-50 transition-colors disabled:opacity-50"
              >
                {syncing ? 'Testing...' : 'Test first'}
              </button>
            )}
          </div>

          {syncResult && (
            <div className="bg-green-50 border border-green-200 rounded-xl p-4">
              <p className="text-sm font-semibold text-green-800 mb-1">Connection works!</p>
              <p className="text-sm text-green-700">{syncResult.tradeCount} trades found</p>
              <p className="text-sm text-green-700">{syncResult.openPositionCount} open positions</p>
            </div>
          )}

          {syncError && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-4">
              <p className="text-sm font-semibold text-red-800 mb-1">Connection failed</p>
              <p className="text-sm text-red-600">{syncError}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

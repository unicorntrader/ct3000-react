import React, { useState, useEffect } from 'react';
import * as Sentry from '@sentry/react';
import { supabase } from '../lib/supabaseClient';
import { fmtPrice, fmtQty } from '../lib/formatters';
import { useDataVersion, useInitialLoadTracker, useBumpDataVersion } from '../lib/DataVersionContext';
import LoadError from '../components/LoadError';
import PrivacyValue from '../components/PrivacyValue';

// Compact "today 14:39" / "yesterday 09:42" / "Apr 23 16:13" formatter
// for the new-fills preview list. Uses the user's local timezone --
// trades.date_time is now stored as real UTC (post the 2026-04-25 tz fix)
// so toLocaleString picks up the user's browser tz correctly.
function formatFillTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const yest = new Date(now); yest.setDate(now.getDate() - 1);
  const isYest = d.toDateString() === yest.toDateString();
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (sameDay) return `today ${time}`;
  if (isYest)  return `yesterday ${time}`;
  return `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${time}`;
}

// Wrap a sync/rebuild step's error with a "which step failed" tag so the
// Sentry ticket and the UI both say something actionable. Also swallows
// the "was this a Supabase error object vs a thrown Error" distinction.
function reportSyncError(step, err) {
  const message = err?.message || String(err);
  Sentry.withScope((scope) => {
    scope.setTag('flow', 'ibkr-sync');
    scope.setTag('sync_step', step);
    if (err && typeof err === 'object') {
      scope.setContext('supabase_error', { code: err.code, details: err.details, hint: err.hint });
    }
    Sentry.captureException(err instanceof Error ? err : new Error(`[${step}] ${message}`));
  });
  return message;
}

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
  const [rebuilding, setRebuilding] = useState(false);
  const [fetchingXml, setFetchingXml] = useState(false);
  const [autoSync, setAutoSync] = useState(true);
  const [togglingAutoSync, setTogglingAutoSync] = useState(false);
  const [syncResult, setSyncResult] = useState(null);
  const [syncError, setSyncError] = useState(null);
  const [saveError, setSaveError] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);

  const userId = session?.user?.id;

  // Cross-screen data invalidation — refetch silently when watched tables
  // are mutated elsewhere. See lib/DataVersionContext for the key map.
  const [ibkrCredsV] = useDataVersion('ibkrCreds');
  const bump = useBumpDataVersion();
  const loadTracker = useInitialLoadTracker(reloadKey);

  useEffect(() => {
    if (!userId) return;
    const isInitial = loadTracker.isInitial;
    if (isInitial) setLoading(true);
    setLoadError(null);
    (async () => {
      try {
        const { data, error } = await supabase
          .from('user_ibkr_credentials')
          .select('token_masked, query_id_masked, last_sync_at, auto_sync_enabled')
          .eq('user_id', userId)
          .single();
        // PGRST116 = no rows = "not connected yet", expected for new users.
        if (error && error.code !== 'PGRST116') throw error;
        if (data) {
          setConnected(true);
          setMaskedToken(data.token_masked || '');
          setMaskedQueryId(data.query_id_masked || '');
          setLastSyncAt(data.last_sync_at);
          setAutoSync(data.auto_sync_enabled ?? true);
        } else {
          setConnected(false);
        }
      } catch (err) {
        console.error('[ibkr] credentials load failed:', err?.message || err);
        Sentry.withScope((scope) => {
          scope.setTag('screen', 'ibkr');
          scope.setTag('step', 'load-credentials');
          scope.setTag('load_kind', isInitial ? 'initial' : 'silent-refetch');
          Sentry.captureException(err instanceof Error ? err : new Error(String(err)));
        });
        if (isInitial) setLoadError(err?.message || 'Could not load IBKR connection.');
      } finally {
        if (isInitial) setLoading(false);
        loadTracker.markLoaded();
      }
    })();
  }, [userId, reloadKey, ibkrCredsV]); // eslint-disable-line react-hooks/exhaustive-deps

  // Credential save + remove now flow through /api/ibkr-credentials so the
  // raw ibkr_token / query_id_30d never traverse the anon DB role. The
  // matching migration revokes browser INSERT/UPDATE/DELETE on the table
  // (with a narrow exception for the auto_sync_enabled column, used by
  // the toggle below). See api/ibkr-credentials.js for the validation
  // rules + masking; the masked variants come back in the response.
  const handleSaveCredentials = async () => {
    if (!token || !queryId) {
      setSaveError('Please enter both your token and Query ID.');
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const { data: { session: currentSession } } = await supabase.auth.getSession();
      const res = await fetch('/api/ibkr-credentials', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${currentSession.access_token}`,
        },
        body: JSON.stringify({ token, queryId }),
      });
      const rawText = await res.text();
      let data;
      try { data = JSON.parse(rawText); }
      catch {
        setSaveError(`HTTP ${res.status} — non-JSON response: ${rawText.slice(0, 200)}`);
        return;
      }
      if (!res.ok || !data.success) {
        setSaveError(data.error || `Save failed (HTTP ${res.status})`);
        return;
      }
      bump('ibkrCreds');
      setConnected(true);
      setMaskedToken(data.tokenMasked || '');
      setMaskedQueryId(data.queryIdMasked || '');
      setToken('');
      setQueryId('');
    } catch (err) {
      setSaveError(err?.message || 'Could not save credentials.');
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async () => {
    try {
      const { data: { session: currentSession } } = await supabase.auth.getSession();
      const res = await fetch('/api/ibkr-credentials', {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${currentSession.access_token}` },
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        console.error('[ibkr] remove failed:', data.error || `HTTP ${res.status}`);
        alert(`Could not disconnect IBKR: ${data.error || `HTTP ${res.status}`}`);
        return;
      }
      bump('ibkrCreds', 'trades', 'positions');
      setConnected(false);
      setMaskedToken('');
      setMaskedQueryId('');
      setSyncResult(null);
      setSyncError(null);
    } catch (err) {
      console.error('[ibkr] remove failed:', err?.message || err);
      alert(`Could not disconnect IBKR: ${err?.message || err}`);
    }
  };

  // Calls the server-side rebuild endpoint.
  // Returns null on success, an error string on failure, or '__warn__...' for warnings.
  // Wraps the network call in try/catch so a dropped connection or malformed
  // response surfaces as a readable error instead of crashing the caller
  // (which is part of the Sync Now flow that must degrade gracefully).
  const rebuildLogicalTrades = async () => {
    try {
      const { data: { session: currentSession } } = await supabase.auth.getSession();
      const res = await fetch('/api/rebuild', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${currentSession.access_token}` },
      });
      const rawText = await res.text();
      let data;
      try { data = JSON.parse(rawText); }
      catch {
        return `HTTP ${res.status} — non-JSON response: ${rawText.slice(0, 200)}`;
      }
      if (!data.success) return data.error || `Rebuild failed (HTTP ${res.status})`;
      if (data.warnings?.length) return `__warn__${data.warnings.join('; ')}`;
      return null;
    } catch (err) {
      return err?.message || 'Network error while rebuilding';
    }
  };

  const handleRebuild = async () => {
    setRebuilding(true);
    setSyncResult(null);
    setSyncError(null);
    const result = await rebuildLogicalTrades();
    if (result?.startsWith('__warn__')) {
      bump('trades');
      setSyncResult({ rebuilt: true, warning: result.slice(8) });
    } else if (result) {
      setSyncError(`Rebuild failed: ${result}`);
    } else {
      bump('trades');
      setSyncResult({ rebuilt: true });
    }
    setRebuilding(false);
  };

  const handleToggleAutoSync = async () => {
    const next = !autoSync;
    setTogglingAutoSync(true);
    setAutoSync(next); // optimistic
    const { error } = await supabase
      .from('user_ibkr_credentials')
      .update({ auto_sync_enabled: next })
      .eq('user_id', userId);
    if (error) {
      setAutoSync(!next); // revert
      alert(`Could not update auto-sync: ${error.message}`);
    }
    setTogglingAutoSync(false);
  };

  const handleDebugXml = async () => {
    setFetchingXml(true);
    try {
      const { data: { session: currentSession } } = await supabase.auth.getSession();
      const res = await fetch('/api/debug-flex-xml', {
        headers: { 'Authorization': `Bearer ${currentSession.access_token}` },
      });
      if (!res.ok) {
        const msg = await res.text();
        alert(`Debug XML failed: ${res.status} — ${msg.slice(0, 200)}`);
        return;
      }
      const xml = await res.text();
      const blob = new Blob([xml], { type: 'application/xml' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `ibkr-flex-${new Date().toISOString().replace(/[:.]/g, '-')}.xml`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      alert(`Debug XML failed: ${err.message}`);
    } finally {
      setFetchingXml(false);
    }
  };

  // /api/sync is now server-authoritative: it fetches IBKR, parses, persists
  // trades + positions, clears demo rows, updates credentials, rebuilds
  // logical_trades, all in one server-side flow. The browser just POSTs a
  // JWT and consumes a summary response (counts + warnings). No more
  // split-brain state if the tab dies between the response and a follow-up
  // write. See api/sync.js for the refactor rationale.
  const handleSync = async () => {
    setSyncing(true);
    setSyncResult(null);
    setSyncError(null);
    try {
      const { data: { session: currentSession } } = await supabase.auth.getSession();
      const res = await fetch('/api/sync', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${currentSession.access_token}`,
        },
      });

      const rawText = await res.text();
      let result;
      try { result = JSON.parse(rawText); }
      catch {
        const msg = `HTTP ${res.status} — non-JSON response: ${rawText.slice(0, 200)}`;
        reportSyncError('sync-response', new Error(msg));
        setSyncError(msg);
        return;
      }

      if (!result.success) {
        reportSyncError('sync-server', new Error(result.error || `HTTP ${res.status}`));
        setSyncError(`HTTP ${res.status} — ${result.error}`);
        return;
      }

      // Server already updated last_sync_at; refresh local cached value and
      // bump data versions so other screens silently refetch.
      setLastSyncAt(new Date().toISOString());
      bump('trades', 'positions', 'ibkrCreds');

      const warnings = result.rebuildWarnings || [];
      setSyncResult({
        tradeCount: result.tradeCount,
        openPositionCount: result.openPositionCount,
        logicalCount: result.logicalCount,
        newTradeCount: result.newTradeCount,
        newTradesPreview: result.newTradesPreview || [],
        ...(warnings.length ? { warning: warnings.join('; ') } : {}),
      });
    } catch (err) {
      reportSyncError('unhandled', err);
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
      const { data: { session: currentSession } } = await supabase.auth.getSession();
      const res = await fetch('/api/sync', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${currentSession.access_token}`,
        },
        body: JSON.stringify({ token, queryId }),
      });
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

  if (loadError) {
    return (
      <div>
        <h2 className="text-xl font-semibold text-gray-900 mb-4">Interactive Brokers</h2>
        <LoadError title="Could not load IBKR connection" message={loadError} onRetry={() => setReloadKey(k => k + 1)} />
      </div>
    );
  }

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
            <div className="px-5 py-4 flex items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-900">Auto-sync</p>
                <p className="text-xs text-gray-400 mt-0.5">
                  {autoSync
                    ? 'Runs nightly ~10pm ET. You can still use "Sync now" any time.'
                    : 'Off — use "Sync now" to pull the latest trades.'}
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={autoSync}
                aria-label="Toggle auto-sync"
                onClick={handleToggleAutoSync}
                disabled={togglingAutoSync}
                className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
                  autoSync ? 'bg-blue-600' : 'bg-gray-200'
                }`}
              >
                <span
                  className={`inline-block h-5 w-5 rounded-full bg-white shadow transform transition-transform ${
                    autoSync ? 'translate-x-5' : 'translate-x-0.5'
                  }`}
                />
              </button>
            </div>
          </div>

          <div className="flex gap-3">
            <button
              onClick={handleSync}
              disabled={syncing || rebuilding}
              className="flex-1 bg-blue-600 text-white font-semibold py-3 rounded-xl text-sm hover:bg-blue-700 transition-colors disabled:opacity-50 flex items-center justify-center space-x-2"
            >
              <svg className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              <span>{syncing ? 'Syncing...' : 'Sync now'}</span>
            </button>
            <button
              onClick={handleRebuild}
              disabled={syncing || rebuilding}
              className="border border-gray-200 text-gray-700 font-medium py-3 px-4 rounded-xl text-sm hover:bg-gray-50 transition-colors disabled:opacity-50 flex items-center justify-center space-x-2"
              title="Rebuild logical trades from existing raw data (no IBKR connection needed)"
            >
              <svg className={`w-4 h-4 ${rebuilding ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
              <span>{rebuilding ? 'Rebuilding...' : 'Rebuild'}</span>
            </button>
            {session?.user?.email === 'antonis@protopapas.net' && (
              <button
                onClick={handleDebugXml}
                disabled={syncing || rebuilding || fetchingXml}
                className="border border-gray-200 text-gray-700 font-medium py-3 px-4 rounded-xl text-sm hover:bg-gray-50 transition-colors disabled:opacity-50 flex items-center justify-center space-x-2"
                title="Open the raw IBKR Flex XML in a new tab"
              >
                <span>{fetchingXml ? 'Fetching...' : 'Raw XML'}</span>
              </button>
            )}
          </div>

          {syncResult && (
            <div className="bg-green-50 border border-green-200 rounded-xl p-4">
              {syncResult.rebuilt ? (
                <>
                  <p className="text-sm font-semibold text-green-800">Logical trades rebuilt successfully</p>
                  {syncResult.warning && (
                    <p className="text-xs text-amber-700 mt-1.5 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                      ⚠ {syncResult.warning}
                    </p>
                  )}
                </>
              ) : (
                <>
                  {/* Lead with the delta. The previous "49 trades saved"
                      copy was misleading: most of those were the same
                      30-day window being re-pulled. Users care about
                      what's new since the last sync. */}
                  {syncResult.newTradeCount === 0 ? (
                    <>
                      <p className="text-sm font-semibold text-green-800">Already up to date</p>
                      <p className="text-sm text-green-700 mt-1">No new fills since your last sync.</p>
                    </>
                  ) : (
                    <>
                      <p className="text-sm font-semibold text-green-800 mb-2">
                        {syncResult.newTradeCount} new fill{syncResult.newTradeCount !== 1 ? 's' : ''} synced
                      </p>
                      {syncResult.newTradesPreview && syncResult.newTradesPreview.length > 0 && (
                        <ul className="text-sm text-green-800 space-y-1 mb-1">
                          {syncResult.newTradesPreview.map((t, i) => (
                            <li key={i} className="flex items-center gap-3 font-mono text-xs">
                              <span className="font-semibold w-16 truncate">{t.symbol}</span>
                              <span className={`font-semibold w-10 ${t.buySell === 'BUY' ? 'text-green-700' : 'text-red-600'}`}>
                                {t.buySell}
                              </span>
                              <span className="w-16 text-right">
                                <PrivacyValue value={fmtQty(t.quantity)} />
                              </span>
                              <span className="w-20 text-right">@ {fmtPrice(t.price, t.currency)}</span>
                              <span className="text-green-600 ml-auto">{formatFillTime(t.dateTime)}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                      {syncResult.newTradeCount > (syncResult.newTradesPreview?.length || 0) && (
                        <p className="text-xs text-green-600 italic">
                          + {syncResult.newTradeCount - (syncResult.newTradesPreview?.length || 0)} more
                        </p>
                      )}
                    </>
                  )}
                  {/* Small footer with the round-numbers as context, not headline. */}
                  <p className="text-xs text-green-600 mt-3">
                    Window total: {syncResult.tradeCount} fills · {syncResult.openPositionCount} positions
                    {typeof syncResult.logicalCount === 'number' ? ` · ${syncResult.logicalCount} logical trades` : ''}
                  </p>
                  <p className="text-xs text-green-600 mt-2 italic">
                    Note: IBKR Flex Queries are batch reports — new executions typically appear 10–30 minutes after the fill, and same-day trades may only settle after 4pm ET. If a recent trade is missing, wait a bit and sync again.
                  </p>
                  {syncResult.warning && (
                    <p className="text-xs text-amber-700 mt-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                      ⚠ {syncResult.warning}
                    </p>
                  )}
                </>
              )}
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

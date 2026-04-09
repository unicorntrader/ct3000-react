import React, { useState } from 'react';

export default function IBKRScreen({ onBack }) {
  const [connected, setConnected] = useState(true);
  const [token, setToken] = useState('');
  const [queryId, setQueryId] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState(null);
  const [syncError, setSyncError] = useState(null);

  const handleConnect = () => {
    if (!token || !queryId) { alert('Please enter both your token and Query ID.'); return; }
    setConnected(true);
  };

  const handleTestSync = async () => {
    setSyncing(true);
    setSyncResult(null);
    setSyncError(null);
    try {
      const res = await fetch(`/api/sync?token=${token}&queryId=${queryId}`);
      const data = await res.json();
      if (data.success) {
        setSyncResult(data);
      } else {
        setSyncError(data.error);
      }
    } catch (err) {
      setSyncError(err.message);
    } finally {
      setSyncing(false);
    }
  };

  const handleConnectedSync = async () => {
    setSyncing(true);
    setSyncResult(null);
    setSyncError(null);
    try {
      const res = await fetch('/api/sync');
      const data = await res.json();
      if (data.success) {
        setSyncResult(data);
      } else {
        setSyncError(data.error);
      }
    } catch (err) {
      setSyncError(err.message);
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div>
      <div className="flex items-center space-x-3 mb-6">
        <button onClick={onBack} className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <h2 className="text-xl font-semibold text-gray-900">Interactive Brokers</h2>
      </div>

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
              <p className="text-xs text-green-600 mt-0.5">Account U12345678 &middot; Syncing daily at 4:30pm ET</p>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-gray-100 divide-y divide-gray-50">
            <div className="px-5 py-4 flex items-center justify-between">
              <div><p className="text-sm font-medium text-gray-900">Last sync</p><p className="text-xs text-gray-400 mt-0.5">Today at 4:35pm &middot; 247 trades imported</p></div>
              <svg className="w-4 h-4 text-green-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <div className="px-5 py-4 flex items-center justify-between">
              <div><p className="text-sm font-medium text-gray-900">Auto-sync</p><p className="text-xs text-gray-400 mt-0.5">Runs daily after US market close</p></div>
              <label className="toggle"><input type="checkbox" defaultChecked /><span className="toggle-slider" /></label>
            </div>
            <div className="px-5 py-4 flex items-center justify-between">
              <div><p className="text-sm font-medium text-gray-900">Flex Query token</p><p className="text-xs text-gray-400 mt-0.5 font-mono">&bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull;3421</p></div>
              <button onClick={() => setConnected(false)} className="text-xs text-blue-600 font-medium cursor-pointer hover:underline">Remove</button>
            </div>
            <div className="px-5 py-4 flex items-center justify-between">
              <div><p className="text-sm font-medium text-gray-900">Query ID (30 days)</p><p className="text-xs text-gray-400 mt-0.5 font-mono">&bull;&bull;&bull;&bull;23</p></div>
              <button onClick={() => setConnected(false)} className="text-xs text-blue-600 font-medium cursor-pointer hover:underline">Update</button>
            </div>
          </div>

          <button
            onClick={handleConnectedSync}
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
              <p className="text-sm text-green-700">{syncResult.tradeCount} trades fetched</p>
              <p className="text-sm text-green-700">{syncResult.openPositionCount} open positions</p>
              {syncResult.trades && syncResult.trades.length > 0 && (
                <div className="mt-3">
                  <p className="text-xs font-semibold text-green-700 mb-1">First trade:</p>
                  <pre className="text-xs text-green-700 bg-green-100 rounded-lg p-2 overflow-x-auto">
                    {JSON.stringify(syncResult.trades[0], null, 2)}
                  </pre>
                </div>
              )}
            </div>
          )}

          {syncError && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-4">
              <p className="text-sm font-semibold text-red-800 mb-1">Sync failed</p>
              <p className="text-sm text-red-600">{syncError}</p>
            </div>
          )}

          <div className="bg-white rounded-xl border border-gray-100 p-5">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">Sync history</h3>
            <div className="space-y-2">
              {[
                { date: 'Apr 9, 2026 · 4:35pm', trades: '247 trades' },
                { date: 'Apr 8, 2026 · 4:35pm', trades: '12 trades' },
                { date: 'Apr 7, 2026 · 4:35pm', trades: '0 trades' },
              ].map(row => (
                <div key={row.date} className="flex justify-between text-sm">
                  <span className="text-gray-500">{row.date}</span>
                  <span className="text-gray-700 font-medium">{row.trades}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          <div className="border-2 border-dashed border-gray-200 rounded-2xl p-8 text-center">
            <div className="w-14 h-14 bg-gray-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <svg className="w-7 h-7 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
            <h3 className="text-base font-semibold text-gray-900 mb-1">No IBKR account connected</h3>
            <p className="text-sm text-gray-400">Connect your Interactive Brokers account to import trades automatically</p>
          </div>

          <div className="bg-blue-50 border border-blue-100 rounded-xl p-4">
            <p className="text-xs font-semibold text-blue-800 mb-2">How to get your credentials:</p>
            <ol className="text-xs text-blue-700 space-y-1.5 list-decimal list-inside">
              <li>Log in to IBKR Client Portal</li>
              <li>Go to Performance &amp; Reports &rarr; Flex Queries</li>
              <li>Click Flex Web Service Configuration &rarr; enable &amp; copy your Token</li>
              <li>Create an Activity Flex Query &rarr; note the Query ID</li>
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
                Query ID (30 days) <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                placeholder="e.g. 123456"
                value={queryId}
                onChange={e => setQueryId(e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-gray-50 font-mono"
              />
            </div>
          </div>

          <button
            onClick={handleConnect}
            className="w-full bg-blue-600 text-white font-semibold py-3.5 rounded-xl text-sm hover:bg-blue-700 transition-colors flex items-center justify-center space-x-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            <span>Connect Interactive Brokers</span>
          </button>

          {token && queryId && (
            <button
              onClick={handleTestSync}
              disabled={syncing}
              className="w-full border border-blue-200 text-blue-600 font-semibold py-3 rounded-xl text-sm hover:bg-blue-50 transition-colors disabled:opacity-50"
            >
              {syncing ? 'Testing...' : 'Test connection first'}
            </button>
          )}

          {syncResult && (
            <div className="bg-green-50 border border-green-200 rounded-xl p-4">
              <p className="text-sm font-semibold text-green-800 mb-2">Connection works!</p>
              <p className="text-sm text-green-700">{syncResult.tradeCount} trades found</p>
              <p className="text-sm text-green-700">{syncResult.openPositionCount} open positions</p>
              {syncResult.trades?.[0] && (
                <div className="mt-3">
                  <p className="text-xs font-semibold text-green-700 mb-1">Sample trade:</p>
                  <pre className="text-xs text-green-700 bg-green-100 rounded-lg p-2 overflow-x-auto">
                    {JSON.stringify(syncResult.trades[0], null, 2)}
                  </pre>
                </div>
              )}
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


  return (
    <div>
      <div className="flex items-center space-x-3 mb-6">
        <button
          onClick={onBack}
          className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <h2 className="text-xl font-semibold text-gray-900">Interactive Brokers</h2>
      </div>

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
              <p className="text-xs text-green-600 mt-0.5">Account U12345678 &middot; Syncing daily at 4:30pm ET</p>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-gray-100 divide-y divide-gray-50">
            <div className="px-5 py-4 flex items-center justify-between">
              <div><p className="text-sm font-medium text-gray-900">Last sync</p><p className="text-xs text-gray-400 mt-0.5">Today at 4:35pm &middot; 247 trades imported</p></div>
              <svg className="w-4 h-4 text-green-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <div className="px-5 py-4 flex items-center justify-between">
              <div><p className="text-sm font-medium text-gray-900">Auto-sync</p><p className="text-xs text-gray-400 mt-0.5">Runs daily after US market close</p></div>
              <label className="toggle"><input type="checkbox" defaultChecked /><span className="toggle-slider" /></label>
            </div>
            <div className="px-5 py-4 flex items-center justify-between">
              <div><p className="text-sm font-medium text-gray-900">Flex Query token</p><p className="text-xs text-gray-400 mt-0.5 font-mono">&bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull;3421</p></div>
              <button onClick={() => setConnected(false)} className="text-xs text-blue-600 font-medium cursor-pointer hover:underline">Remove</button>
            </div>
            <div className="px-5 py-4 flex items-center justify-between">
              <div><p className="text-sm font-medium text-gray-900">Query ID (30 days)</p><p className="text-xs text-gray-400 mt-0.5 font-mono">&bull;&bull;&bull;&bull;23</p></div>
              <button onClick={() => setConnected(false)} className="text-xs text-blue-600 font-medium cursor-pointer hover:underline">Update</button>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-gray-100 p-5">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">Sync history</h3>
            <div className="space-y-2">
              {[
                { date: 'Apr 9, 2026 · 4:35pm', trades: '247 trades' },
                { date: 'Apr 8, 2026 · 4:35pm', trades: '12 trades' },
                { date: 'Apr 7, 2026 · 4:35pm', trades: '0 trades' },
              ].map(row => (
                <div key={row.date} className="flex justify-between text-sm">
                  <span className="text-gray-500">{row.date}</span>
                  <span className="text-gray-700 font-medium">{row.trades}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          <div className="border-2 border-dashed border-gray-200 rounded-2xl p-8 text-center">
            <div className="w-14 h-14 bg-gray-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <svg className="w-7 h-7 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
            <h3 className="text-base font-semibold text-gray-900 mb-1">No IBKR account connected</h3>
            <p className="text-sm text-gray-400">Connect your Interactive Brokers account to import trades automatically</p>
          </div>

          <div className="bg-blue-50 border border-blue-100 rounded-xl p-4">
            <p className="text-xs font-semibold text-blue-800 mb-2">How to get your credentials:</p>
            <ol className="text-xs text-blue-700 space-y-1.5 list-decimal list-inside">
              <li>Log in to IBKR Client Portal</li>
              <li>Go to Performance &amp; Reports &rarr; Flex Queries</li>
              <li>Click Flex Web Service Configuration &rarr; enable &amp; copy your Token</li>
              <li>Create an Activity Flex Query &rarr; note the Query ID</li>
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
              <p className="text-xs text-gray-400 mt-1">23-digit token from IBKR Flex Web Service Configuration</p>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
                Query ID (30 days) <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                placeholder="e.g. 123456"
                value={queryId}
                onChange={e => setQueryId(e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-gray-50 font-mono"
              />
              <p className="text-xs text-gray-400 mt-1">6-digit ID from your Activity Flex Query</p>
            </div>
          </div>

          <button
            onClick={handleConnect}
            className="w-full bg-blue-600 text-white font-semibold py-3.5 rounded-xl text-sm hover:bg-blue-700 transition-colors flex items-center justify-center space-x-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            <span>Connect Interactive Brokers</span>
          </button>
        </div>
      )}
    </div>
  );
}

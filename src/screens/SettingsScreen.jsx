import React, { useState, useEffect } from 'react';
import * as Sentry from '@sentry/react';
import { supabase } from '../lib/supabaseClient';
import { useDataVersion, useInitialLoadTracker } from '../lib/DataVersionContext';
import LoadError from '../components/LoadError';

function Section({ title, children }) {
  return (
    <div>
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2 px-1">
        {title}
      </p>
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm divide-y divide-gray-50 overflow-hidden">
        {children}
      </div>
    </div>
  );
}

function Row({ label, hint, children }) {
  return (
    <div className="px-5 py-4 flex items-center justify-between gap-4">
      <div className="min-w-0">
        <p className="text-sm font-medium text-gray-900">{label}</p>
        {hint && <p className="text-xs text-gray-400 mt-0.5">{hint}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function ComingSoonRow({ label }) {
  return (
    <Row label={label}>
      <span className="text-xs text-gray-400 bg-gray-100 px-2.5 py-1 rounded-full font-medium">
        Coming soon
      </span>
    </Row>
  );
}

export default function SettingsScreen({ session }) {
  const [baseCurrency, setBaseCurrency] = useState(null);
  const [accountId, setAccountId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);

  // Cross-screen data invalidation — refetch silently when watched tables
  // are mutated elsewhere. See lib/DataVersionContext for the key map.
  const [ibkrCredsV] = useDataVersion('ibkrCreds');
  const loadTracker = useInitialLoadTracker(reloadKey);

  useEffect(() => {
    if (!session?.user?.id) return;
    const isInitial = loadTracker.isInitial;
    if (isInitial) setLoading(true);
    setLoadError(null);
    (async () => {
      try {
        const { data, error } = await supabase
          .from('user_ibkr_credentials')
          .select('base_currency, account_id')
          .eq('user_id', session.user.id)
          .single();
        // PGRST116 = no rows found, expected for users who haven't connected
        // IBKR yet — not an error, just means defaults apply.
        if (error && error.code !== 'PGRST116') throw error;
        setBaseCurrency(data?.base_currency || null);
        setAccountId(data?.account_id || null);
      } catch (err) {
        console.error('[settings] load failed:', err?.message || err);
        Sentry.withScope((scope) => {
          scope.setTag('screen', 'settings');
          scope.setTag('step', 'load');
          scope.setTag('load_kind', isInitial ? 'initial' : 'silent-refetch');
          Sentry.captureException(err instanceof Error ? err : new Error(String(err)));
        });
        if (isInitial) setLoadError(err?.message || 'Could not load settings.');
      } finally {
        if (isInitial) setLoading(false);
        loadTracker.markLoaded();
      }
    })();
  }, [session?.user?.id, reloadKey, ibkrCredsV]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loadError) {
    return (
      <div>
        <h2 className="text-xl font-semibold text-gray-900 mb-4">Settings</h2>
        <LoadError title="Could not load settings" message={loadError} onRetry={() => setReloadKey(k => k + 1)} />
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
    <div className="space-y-6 max-w-lg" style={{}}>
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-gray-900">Settings</h2>
        <button
          onClick={() => setReloadKey(k => k + 1)}
          className="text-xs text-blue-600 font-medium px-3 py-1.5 rounded-lg hover:bg-blue-50 transition-colors"
        >
          Refresh
        </button>
      </div>

      {/* ── Account ── */}
      <Section title="Account">
        <Row
          label="Base currency"
          hint="Detected from your IBKR account"
        >
          {baseCurrency ? (
            <span className="text-sm font-semibold text-gray-900 bg-gray-100 px-3 py-1 rounded-lg font-mono">
              {baseCurrency}
            </span>
          ) : (
            <span className="text-sm text-gray-400">
              {accountId ? 'Sync to detect' : 'Connect IBKR first'}
            </span>
          )}
        </Row>
        <Row label="IBKR account" hint="Linked account ID">
          <span className="text-sm text-gray-500 font-mono">{accountId || '—'}</span>
        </Row>
        <Row label="Email">
          <span className="text-sm text-gray-500 truncate max-w-48">{session?.user?.email || '—'}</span>
        </Row>
      </Section>

      {/* ── Display ── */}
      <Section title="Display">
        <ComingSoonRow label="Theme" />
        <ComingSoonRow label="Default date range" />
        <ComingSoonRow label="Timezone" />
      </Section>

      {/* ── Notifications ── */}
      <Section title="Notifications">
        <ComingSoonRow label="Daily P&L summary" />
        <ComingSoonRow label="Trade review reminders" />
      </Section>

      {/* ── Data ── */}
      <Section title="Data">
        <ComingSoonRow label="Auto-sync schedule" />
        <ComingSoonRow label="Export trades (CSV)" />
        <ComingSoonRow label="Position sizing defaults" />
      </Section>
    </div>
  );
}

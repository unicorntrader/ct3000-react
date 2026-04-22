import React, { useState, useEffect } from 'react';
import * as Sentry from '@sentry/react';
import { supabase } from '../lib/supabaseClient';
import { useDataVersion, useInitialLoadTracker } from '../lib/DataVersionContext';
import { SUPPORT_EMAIL, APP_VERSION, supportMailto } from '../lib/constants';
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

      {/* ── Support ── */}
      <Section title="Support">
        <a
          href={supportMailto('CT3000 — Need help')}
          className="px-5 py-4 flex items-center justify-between gap-4 hover:bg-gray-50 transition-colors"
        >
          <div className="min-w-0">
            <p className="text-sm font-medium text-gray-900">Contact support</p>
            <p className="text-xs text-gray-400 mt-0.5 truncate">{SUPPORT_EMAIL}</p>
          </div>
          <svg className="w-4 h-4 text-gray-300 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
          </svg>
        </a>
        <a
          href={supportMailto('CT3000 — Bug report', 'What happened:\n\nWhat I expected:\n\nSteps to reproduce:\n\n')}
          className="px-5 py-4 flex items-center justify-between gap-4 hover:bg-gray-50 transition-colors"
        >
          <div className="min-w-0">
            <p className="text-sm font-medium text-gray-900">Report a bug</p>
            <p className="text-xs text-gray-400 mt-0.5">Opens your email with a template</p>
          </div>
          <svg className="w-4 h-4 text-gray-300 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
          </svg>
        </a>
      </Section>

      {/* ── About ──
          App version sits here (and on the sidebar footer) so users pasting
          it into a support email gives us instant triage context. Bump the
          APP_VERSION constant in lib/constants.js on meaningful releases. */}
      <Section title="About">
        <Row label="App version" hint="Include this when you email support">
          <span className="text-xs text-gray-500 font-mono bg-gray-100 px-2.5 py-1 rounded">
            {APP_VERSION}
          </span>
        </Row>
      </Section>
    </div>
  );
}

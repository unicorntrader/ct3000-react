import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabaseClient';

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
  const [fetchError, setFetchError] = useState(null);

  const fetchSettings = () => {
    if (!session?.user?.id) return;
    setLoading(true);
    setFetchError(null);
    supabase
      .from('user_ibkr_credentials')
      .select('base_currency, account_id')
      .eq('user_id', session.user.id)
      .single()
      .then(({ data, error }) => {
        if (error && error.code !== 'PGRST116') {
          // PGRST116 = no rows found — that's fine, show defaults
          setFetchError(error.message);
        }
        setBaseCurrency(data?.base_currency || null);
        setAccountId(data?.account_id || null);
        setLoading(false);
      });
  };

  useEffect(fetchSettings, [session?.user?.id]);

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
          onClick={fetchSettings}
          className="text-xs text-blue-600 font-medium px-3 py-1.5 rounded-lg hover:bg-blue-50 transition-colors"
        >
          Refresh
        </button>
      </div>

      {fetchError && (
        <div className="bg-red-50 border border-red-100 rounded-xl px-4 py-3 text-sm text-red-600">
          Failed to load settings: {fetchError}
        </div>
      )}

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

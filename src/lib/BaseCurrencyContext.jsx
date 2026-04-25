import React, { createContext, useContext, useEffect, useState } from 'react';
import * as Sentry from '@sentry/react';
import { supabase } from './supabaseClient';

const BaseCurrencyContext = createContext({ baseCurrency: 'USD', loading: true });

/**
 * Fetches the user's base currency once per session from user_ibkr_credentials
 * and provides it to any descendant via useBaseCurrency().
 *
 * Replaces the previous pattern where 5 different screens each ran their own
 * query on mount. Single round-trip, single source of truth.
 *
 * Failure handling: silently fall back to USD so the app keeps working, but
 * send a Sentry event so we can see breakage. Not worth a retry UI here -- the
 * base currency is background state, not user-facing primary content.
 */
export function BaseCurrencyProvider({ userId, children }) {
  const [baseCurrency, setBaseCurrency] = useState('USD');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userId) { setLoading(false); return; }
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await supabase
          .from('user_ibkr_credentials')
          .select('base_currency')
          .eq('user_id', userId)
          .maybeSingle();
        if (cancelled) return;
        // PGRST116 = no row (user hasn't connected IBKR yet) — expected.
        if (error && error.code !== 'PGRST116') throw error;
        if (data?.base_currency) setBaseCurrency(data.base_currency);
      } catch (err) {
        if (cancelled) return;
        console.error('[BaseCurrencyProvider] fetch failed:', err?.message || err);
        Sentry.withScope((scope) => {
          scope.setTag('context', 'base-currency');
          scope.setTag('step', 'load');
          Sentry.captureException(err instanceof Error ? err : new Error(String(err)));
        });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [userId]);

  return (
    <BaseCurrencyContext.Provider value={{ baseCurrency, loading }}>
      {children}
    </BaseCurrencyContext.Provider>
  );
}

export function useBaseCurrency() {
  return useContext(BaseCurrencyContext).baseCurrency;
}

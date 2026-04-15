import React, { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from './supabaseClient';

const BaseCurrencyContext = createContext({ baseCurrency: 'USD', loading: true });

/**
 * Fetches the user's base currency once per session from user_ibkr_credentials
 * and provides it to any descendant via useBaseCurrency().
 *
 * Replaces the previous pattern where 5 different screens each ran their own
 * query on mount. Single round-trip, single source of truth.
 */
export function BaseCurrencyProvider({ userId, children }) {
  const [baseCurrency, setBaseCurrency] = useState('USD');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userId) { setLoading(false); return; }
    let cancelled = false;
    supabase
      .from('user_ibkr_credentials')
      .select('base_currency')
      .eq('user_id', userId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error && error.code !== 'PGRST116') {
          console.error('[BaseCurrencyProvider] fetch failed:', error.message);
        }
        if (data?.base_currency) setBaseCurrency(data.base_currency);
        setLoading(false);
      });
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

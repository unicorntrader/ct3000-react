import React, { createContext, useContext, useState, useCallback, useMemo, useRef, useEffect } from 'react';

/**
 * DataVersionContext — cross-screen data invalidation.
 *
 * Combined with keep-alive navigation (App.jsx), screens stay mounted across
 * tab switches. That means data they fetched on first visit isn't naturally
 * refreshed when the user comes back. This context lets a mutation on one
 * screen signal "the data this group depends on just changed" — watching
 * screens pick up the signal and silently refetch in the background next
 * time they run their effect.
 *
 * KEYS (one bump = all watchers refetch):
 *   trades      — logical_trades, logical_trade_executions, adherence
 *   plans       — planned_trades
 *   positions   — open_positions
 *   playbooks   — playbooks
 *   notes       — daily_notes
 *   ibkrCreds   — user_ibkr_credentials
 *
 * Screens wire up by calling:
 *   const [tradesV, plansV] = useDataVersion('trades', 'plans')
 * and adding those to their useEffect dependency array.
 *
 * Mutators call:
 *   const bump = useBumpDataVersion()
 *   // after successful write:
 *   bump('trades', 'positions')
 *
 * Spinner policy: on a version-bump refetch, screens use useSilentRefetch()
 * to suppress the spinner. Initial mount and user-triggered retries still
 * show the spinner. See useSilentRefetch below.
 */

const DEFAULT_VERSIONS = {
  trades: 0,
  plans: 0,
  positions: 0,
  playbooks: 0,
  notes: 0,
  ibkrCreds: 0,
};

const DataVersionContext = createContext(null);

export function DataVersionProvider({ children }) {
  const [versions, setVersions] = useState(DEFAULT_VERSIONS);

  const bump = useCallback((...keys) => {
    if (keys.length === 0) return;
    setVersions(prev => {
      const next = { ...prev };
      for (const k of keys) {
        if (k in next) next[k] = next[k] + 1;
        else console.warn(`[DataVersion] unknown key bumped: ${k}`);
      }
      return next;
    });
  }, []);

  const value = useMemo(() => ({ ...versions, bump }), [versions, bump]);
  return <DataVersionContext.Provider value={value}>{children}</DataVersionContext.Provider>;
}

/**
 * Returns the current version counters for the given keys, as an array in
 * the same order as the arguments. Designed to be spread or destructured
 * into a useEffect dependency array so the effect re-fires on bump.
 *
 *   const [tradesV, plansV] = useDataVersion('trades', 'plans')
 *   useEffect(() => { fetch(...) }, [userId, reloadKey, tradesV, plansV])
 */
export function useDataVersion(...keys) {
  const ctx = useContext(DataVersionContext);
  if (!ctx) {
    // Graceful fallback for code paths that render outside the provider
    // (tests, storybook, etc.) — always return zeros so effects fire once.
    return keys.map(() => 0);
  }
  return keys.map(k => ctx[k] ?? 0);
}

/**
 * Returns the bump function. Mutators call this after a successful write
 * with the list of keys that are now stale elsewhere.
 */
export function useBumpDataVersion() {
  const ctx = useContext(DataVersionContext);
  return ctx?.bump ?? (() => {});
}

/**
 * Hook that reports whether the current load is the "initial" one (first
 * mount, or user-triggered retry via reloadKey) vs a silent refetch driven
 * by a data-version bump.
 *
 * Screens use this to guard setLoading(true) and setLoadError — silent
 * refetches should swap data in without flashing a spinner, and transient
 * refetch errors should be logged but not replace the UI with LoadError
 * (the user is still looking at their last-known-good data).
 *
 * Usage inside the fetch useEffect:
 *   const { isInitial, markLoaded } = useInitialLoadTracker(reloadKey)
 *   if (isInitial) setLoading(true)
 *   try { ... }
 *   catch (err) { if (isInitial) setLoadError(err.message) else logOnly(err) }
 *   finally { if (isInitial) setLoading(false); markLoaded() }
 */
export function useInitialLoadTracker(reloadKey) {
  const loadedRef = useRef(false);
  // Treat a reloadKey bump as "user explicitly asked for a fresh load" —
  // reset so the next fetch shows the spinner again.
  useEffect(() => {
    loadedRef.current = false;
  }, [reloadKey]);
  return {
    get isInitial() { return !loadedRef.current; },
    markLoaded: () => { loadedRef.current = true; },
  };
}

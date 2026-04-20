import React, { useState, useEffect, useCallback, useRef } from 'react';
import * as Sentry from '@sentry/react';
import { supabase } from '../lib/supabaseClient';
import { currencySymbol, fmtPrice, fmtPnl, fmtDate, pnlBase } from '../lib/formatters';
import { usePrivacy } from '../lib/PrivacyContext';
import { useCodeLabels } from '../lib/CodeLabelContext';

// Inline learning-mode label identifying this drawer as PlanSheet.
function PlanSheetLabel() {
  const { enabled } = useCodeLabels();
  if (!enabled) return null;
  return (
    <div className="mb-3 flex items-center gap-2 text-[11px] font-mono flex-wrap">
      <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-purple-600 text-white text-[10px] font-semibold">
        component
      </span>
      <span className="text-gray-700 font-semibold">PlanSheet</span>
      <span className="text-gray-400">·</span>
      <span className="text-gray-500">src/components/PlanSheet.jsx</span>
      <span className="text-gray-400">·</span>
      <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-rose-600 text-white text-[10px] font-semibold" title="Supabase table">
        planned_trades
      </span>
      <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-rose-600 text-white text-[10px] font-semibold" title="Supabase table">
        playbooks
      </span>
      <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-rose-600 text-white text-[10px] font-semibold" title="Supabase table">
        securities
      </span>
    </div>
  );
}

// PlanSheet's background loads (base currency, user symbols, matched count,
// securities search, historical trades) all run on sheet open. They enrich
// the UX but the sheet stays usable if any of them fail — so we degrade
// gracefully (no visible error, no retry UI) and ship the failure to Sentry
// so we see breakage. The user can close + reopen the sheet to retry.
function reportPlanSheetLoadError(step, err) {
  console.error(`[plan-sheet] ${step} failed:`, err?.message || err);
  Sentry.withScope((scope) => {
    scope.setTag('component', 'plan-sheet');
    scope.setTag('step', step);
    Sentry.captureException(err instanceof Error ? err : new Error(String(err)));
  });
}

function calcDuration(opened, closed) {
  if (!opened || !closed) return null;
  const mins = Math.round((new Date(closed) - new Date(opened)) / 60000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

const strategies = [
  { group: 'Timeframe', options: ['Day Trade', 'Swing', 'Position'] },
  { group: 'Setup', options: ['Breakout', 'Support', 'Resistance', 'Momentum'] },
  { group: 'Thesis-driven', options: ['Value', 'Fundamental', 'Macro', 'Catalyst'] },
];

export default function PlanSheet({ session, isOpen, onClose, onSaved, plan }) {
  const isEdit = !!plan?.id;
  const { isPrivate } = usePrivacy();

  const [direction, setDirection] = useState('long');
  const [symbol, setSymbol] = useState('');
  const [assetCategory, setAssetCategory] = useState('STK');
  const [strategy, setStrategy] = useState('');
  const [entry, setEntry] = useState('');
  const [target, setTarget] = useState('');
  const [stop, setStop] = useState('');
  const [qty, setQty] = useState('');
  const [thesis, setThesis] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [baseCurrency, setBaseCurrency] = useState('USD');

  const [debouncedSymbol, setDebouncedSymbol] = useState('');
  const [histTrades, setHistTrades] = useState([]);
  const [histExpanded, setHistExpanded] = useState(false);

  // Securities lookup — autocomplete + instrument info
  const [secSuggestions, setSecSuggestions] = useState([]);
  const [secSuggestOpen, setSecSuggestOpen] = useState(false);
  const [selectedSecurity, setSelectedSecurity] = useState(null);
  const [planCurrency, setPlanCurrency] = useState(null);

  // Tickers the user has touched before (past trades + past/current plans).
  // Fetched once on open; used to boost those tickers to the top of search
  // results so "A" surfaces the user's AAPL before random AA* tickers.
  const [userSymbols, setUserSymbols] = useState(() => new Set());

  // Match protection — count how many trades reference this plan
  // Edit warns the user, delete is blocked, until matches are reset
  const [matchedCount, setMatchedCount] = useState(0);

  const resetForm = useCallback(() => {
    setSymbol(''); setStrategy(''); setDirection('long'); setAssetCategory('STK');
    setEntry(''); setTarget(''); setStop(''); setQty(''); setThesis('');
    setError(null); setSaved(false); setConfirmDelete(false);
    setDebouncedSymbol(''); setHistTrades([]); setHistExpanded(false);
    setSecSuggestions([]); setSecSuggestOpen(false); setSelectedSecurity(null); setPlanCurrency(null);
  }, []);

  const handleClose = useCallback(() => { resetForm(); onClose(); }, [resetForm, onClose]);

  // Fetch base currency when sheet opens
  useEffect(() => {
    if (!isOpen || !session?.user?.id) return;
    (async () => {
      try {
        const { data, error } = await supabase
          .from('user_ibkr_credentials')
          .select('base_currency')
          .eq('user_id', session.user.id)
          .single();
        if (error && error.code !== 'PGRST116') throw error;
        if (data?.base_currency) setBaseCurrency(data.base_currency);
      } catch (err) {
        reportPlanSheetLoadError('load-base-currency', err);
      }
    })();
  }, [isOpen, session?.user?.id]);

  // Fetch the user's relevant ticker set (past trades + past/current plans)
  // so we can rank those to the top in autocomplete. Cheap: indexed by
  // user_id on both tables. Runs once per sheet open.
  useEffect(() => {
    if (!isOpen || !session?.user?.id) return;
    const uid = session.user.id;
    (async () => {
      try {
        const [lt, pt] = await Promise.all([
          supabase.from('logical_trades').select('symbol').eq('user_id', uid),
          supabase.from('planned_trades').select('symbol').eq('user_id', uid),
        ]);
        if (lt.error) throw lt.error;
        if (pt.error) throw pt.error;
        const set = new Set();
        for (const r of (lt.data || [])) if (r.symbol) set.add(r.symbol.toUpperCase());
        for (const r of (pt.data || [])) if (r.symbol) set.add(r.symbol.toUpperCase());
        setUserSymbols(set);
      } catch (err) {
        reportPlanSheetLoadError('load-user-symbols', err);
      }
    })();
  }, [isOpen, session?.user?.id]);

  // Populate form when sheet opens
  useEffect(() => {
    if (!isOpen) return;
    if (plan) {
      setDirection((plan.direction || 'LONG').toLowerCase());
      setSymbol(plan.symbol || '');
      setAssetCategory(plan.asset_category || 'STK');
      setStrategy(plan.strategy || '');
      setEntry(plan.planned_entry_price != null ? String(plan.planned_entry_price) : '');
      setTarget(plan.planned_target_price != null ? String(plan.planned_target_price) : '');
      setStop(plan.planned_stop_loss != null ? String(plan.planned_stop_loss) : '');
      setQty(plan.planned_quantity != null ? String(plan.planned_quantity) : '');
      setThesis(plan.thesis ?? plan.notes ?? '');
      setPlanCurrency(plan.currency || null);
    } else {
      resetForm();
    }
    setError(null);
    setSaved(false);
    setConfirmDelete(false);
    setMatchedCount(0);
  }, [isOpen, plan, resetForm]);

  // Count how many trades reference this plan (edit mode only).
  // Used to block delete + warn on edit.
  useEffect(() => {
    if (!isOpen || !plan?.id || !session?.user?.id) { setMatchedCount(0); return; }
    (async () => {
      try {
        const { count, error } = await supabase
          .from('logical_trades')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', session.user.id)
          .eq('planned_trade_id', plan.id);
        if (error) throw error;
        setMatchedCount(count || 0);
      } catch (err) {
        reportPlanSheetLoadError('load-matched-count', err);
        setMatchedCount(0);
      }
    })();
  }, [isOpen, plan?.id, session?.user?.id]);

  const e = parseFloat(entry) || 0;
  const t = parseFloat(target) || 0;
  const s = parseFloat(stop) || 0;
  const q = parseFloat(qty) || 0;

  // Use the instrument's native currency for position calcs. Falls back to
  // baseCurrency when the security isn't in our lookup yet (new instrument).
  const displayCurrency = planCurrency || baseCurrency;
  const cs = currencySymbol(displayCurrency);
  const posSize = e && q ? `${cs}${(e * q).toLocaleString('en-US', { maximumFractionDigits: 0 })}` : '--';
  const risk = e && s && q ? `${cs}${(Math.abs(e - s) * q).toLocaleString('en-US', { maximumFractionDigits: 0 })}` : '--';
  const reward = e && t && q ? `${cs}${(Math.abs(t - e) * q).toLocaleString('en-US', { maximumFractionDigits: 0 })}` : '--';
  const rr = e && s && t ? (Math.abs(t - e) / Math.abs(e - s)).toFixed(2) + 'R' : '--';
  const rrColor = e && s && t
    ? parseFloat(rr) >= 2 ? 'text-green-600' : parseFloat(rr) >= 1 ? 'text-amber-500' : 'text-red-500'
    : 'text-gray-700';

  const showCalc = e > 0 && q > 0;

  // Ref so keyboard effect always calls the latest handleSave without stale closure
  const handleSaveRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (ev) => {
      if (ev.key === 'Escape') { handleClose(); return; }
      if (ev.key === 'Enter' && !ev.shiftKey && !['INPUT', 'TEXTAREA', 'SELECT'].includes(ev.target.tagName)) {
        ev.preventDefault();
        handleSaveRef.current?.();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, handleClose]);

  // Debounce ticker input for hist trade lookup + securities search
  useEffect(() => {
    const id = setTimeout(() => setDebouncedSymbol(symbol.trim().toUpperCase()), 300);
    return () => clearTimeout(id);
  }, [symbol]);

  // Search securities table for autocomplete. Matches:
  //   - symbol prefix ("N" -> NVDA, "NV" -> NVDA, NVDM, ...)
  //   - company_name substring ("Apple" -> AAPL, "Tesla" -> TSLA)
  //
  // Ranking (best to worst):
  //   1. User-relevant + exact symbol match
  //   2. User-relevant + symbol prefix
  //   3. User-relevant + company_name hit
  //   4. Other + exact symbol match
  //   5. Other + symbol prefix
  //   6. Other + company_name hit
  useEffect(() => {
    if (!debouncedSymbol) {
      setSecSuggestions([]);
      return;
    }
    const q = debouncedSymbol;
    const orFilter = `symbol.ilike.${q}%,company_name.ilike.%${q}%`;

    // Two parallel queries so user-relevant matches aren't crowded out of
    // the LIMIT by alphabetical neighbors in the full table.
    const userList = Array.from(userSymbols);
    const userQ = userList.length > 0
      ? supabase
          .from('securities')
          .select('conid, symbol, asset_category, description, currency, company_name')
          .or(orFilter)
          .in('symbol', userList)
          .limit(8)
      : Promise.resolve({ data: [] });

    (async () => {
      try {
        const [userRes, allRes] = await Promise.all([
          userQ,
          supabase
            .from('securities')
            .select('conid, symbol, asset_category, description, currency, company_name')
            .or(orFilter)
            .limit(12),
        ]);
        if (userRes.error) throw userRes.error;
        if (allRes.error) throw allRes.error;
        const userRows = (userRes.data || []).map(r => ({ ...r, _userRelevant: true }));
        const allRows  = (allRes.data  || []).map(r => ({ ...r, _userRelevant: userSymbols.has((r.symbol || '').toUpperCase()) }));
        // Dedupe by conid, preferring the user-flagged copy
        const byConid = new Map();
        for (const r of [...userRows, ...allRows]) {
          if (!byConid.has(r.conid)) byConid.set(r.conid, r);
        }
        const merged = Array.from(byConid.values());

        const rank = (s) => {
          const sym = (s.symbol || '').toUpperCase();
          const name = (s.company_name || '').toUpperCase();
          const userBonus = s._userRelevant ? 0 : 10;
          if (sym === q)           return userBonus + 0;
          if (sym.startsWith(q))   return userBonus + 1;
          if (name.includes(q))    return userBonus + 2;
          return userBonus + 3;
        };
        merged.sort((a, b) => rank(a) - rank(b));

        const limited = merged.slice(0, 12);
        setSecSuggestions(limited);
        // Do NOT auto-open the dropdown here. It's tempting ("we got results,
        // show them!"), but it fires in edit mode too: the sheet opens with a
        // pre-filled symbol, debouncedSymbol becomes that symbol, this search
        // runs, the dropdown pops open unprompted. We only want the dropdown
        // open when the user actively types or focuses the input — those code
        // paths already call setSecSuggestOpen(true).
      } catch (err) {
        reportPlanSheetLoadError('search-securities', err);
        setSecSuggestions([]);
      }
    })();
  }, [debouncedSymbol, userSymbols]);

  // When user picks a security from autocomplete (or exact match on debounce)
  const handleSelectSecurity = (sec) => {
    setSymbol(sec.symbol);
    setAssetCategory(sec.asset_category || 'STK');
    setPlanCurrency(sec.currency || null);
    setSelectedSecurity(sec);
    setSecSuggestOpen(false);
  };

  // Clear the ticker and every ticker-dependent field — restart the planner
  // from a blank form without having to close and reopen the sheet. Per user
  // intent ("restart the trade planner") this wipes entry/target/stop/qty
  // and thesis too, since those are ticker-specific.
  const handleClearSymbol = () => {
    setSymbol(''); setDebouncedSymbol('');
    setEntry(''); setTarget(''); setStop(''); setQty('');
    setStrategy(''); setThesis('');
    setSecSuggestions([]); setSecSuggestOpen(false);
    setSelectedSecurity(null); setPlanCurrency(null);
    setHistTrades([]); setHistExpanded(false);
    setError(null);
  };

  // Auto-match on exact symbol (user typed full ticker and tabbed out)
  useEffect(() => {
    if (!debouncedSymbol) { setSelectedSecurity(null); setPlanCurrency(null); return; }
    const exact = secSuggestions.find(s => s.symbol.toUpperCase() === debouncedSymbol);
    if (exact && (!selectedSecurity || selectedSecurity.symbol !== exact.symbol)) {
      setAssetCategory(exact.asset_category || 'STK');
      setPlanCurrency(exact.currency || null);
      setSelectedSecurity(exact);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSymbol, secSuggestions]);

  // Whenever a security gets picked (via dropdown click OR exact-match
  // auto-pick), add it to the Recent set so subsequent searches this
  // session show it with the badge and ranking boost — no sheet reopen needed.
  useEffect(() => {
    if (!selectedSecurity?.symbol) return;
    const sym = selectedSecurity.symbol.toUpperCase();
    setUserSymbols(prev => {
      if (prev.has(sym)) return prev;
      const next = new Set(prev);
      next.add(sym);
      return next;
    });
  }, [selectedSecurity?.symbol]);

  // Fetch historical closed trades for this ticker
  useEffect(() => {
    const uid = session?.user?.id;
    if (!debouncedSymbol || !uid) { setHistTrades([]); return; }
    (async () => {
      try {
        const { data, error } = await supabase
          .from('logical_trades')
          .select('id, direction, opened_at, closed_at, avg_entry_price, total_closing_quantity, total_opening_quantity, total_realized_pnl, fx_rate_to_base, currency, multiplier')
          .eq('user_id', uid)
          .eq('symbol', debouncedSymbol)
          .eq('status', 'closed')
          .order('closed_at', { ascending: false });
        if (error) throw error;
        setHistTrades(data || []);
      } catch (err) {
        reportPlanSheetLoadError('load-historical-trades', err);
        setHistTrades([]);
      }
    })();
  }, [debouncedSymbol, session?.user?.id]);

  const handleSave = async () => {
    if (!session?.user?.id) {
      setError('Not logged in. Please refresh and try again.');
      return;
    }
    if (!symbol.trim()) { setError('Ticker is required.'); return; }
    if (!e) { setError('Entry price is required.'); return; }

    // Warn when editing a plan that has matched trades — changes affect
    // historical adherence scores on those trades.
    if (isEdit && matchedCount > 0) {
      const ok = window.confirm(
        `This plan is matched to ${matchedCount} trade${matchedCount !== 1 ? 's' : ''}. ` +
        `Editing will change their plan-vs-actual comparison and adherence scores. Continue?`
      );
      if (!ok) return;
    }

    setError(null);
    setSaving(true);

    // Last-ditch currency resolution. The auto-match effect above already
    // tries to set planCurrency from the security the user typed, but it
    // can miss (race with debounce, or an edit of a pre-existing plan that
    // never got a currency). Before we save a null currency — which makes
    // the UI fall back to baseCurrency and display SPY as EUR for an EUR
    // base user — try one more direct lookup against the securities table.
    let resolvedCurrency = planCurrency;
    if (!resolvedCurrency) {
      try {
        const { data: sec } = await supabase
          .from('securities')
          .select('currency')
          .eq('symbol', symbol.trim().toUpperCase())
          .eq('asset_category', assetCategory)
          .limit(1)
          .maybeSingle();
        if (sec?.currency) resolvedCurrency = sec.currency;
      } catch (err) {
        // Non-fatal — fall through and write null. We'll log so we can see
        // if this is happening in the wild.
        reportPlanSheetLoadError('resolve-currency-on-save', err);
      }
    }

    const payload = {
      user_id:               session.user.id,
      symbol:                symbol.trim().toUpperCase(),
      direction:             direction.toUpperCase(),
      asset_category:        assetCategory,
      currency:              resolvedCurrency || null,
      planned_entry_price:   e || null,
      planned_target_price:  t || null,
      planned_stop_loss:     s || null,
      planned_quantity:      q || null,
      strategy:              strategy || null,
      thesis:                thesis.trim() || null,
    };

    let dbError;
    if (isEdit) {
      ({ error: dbError } = await supabase
        .from('planned_trades')
        .update(payload)
        .eq('id', plan.id)
        .eq('user_id', session.user.id));
    } else {
      ({ error: dbError } = await supabase
        .from('planned_trades')
        .insert(payload));
    }

    setSaving(false);
    if (dbError) {
      setError(`Save failed: ${dbError.message} (code: ${dbError.code})`);
      return;
    }
    setSaved(true);
    setTimeout(() => { handleClose(); onSaved?.(); }, 1200);
  };
  handleSaveRef.current = handleSave;

  const handleDelete = async () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setDeleting(true);
    const { error: dbError } = await supabase
      .from('planned_trades')
      .delete()
      .eq('id', plan.id)
      .eq('user_id', session.user.id);
    setDeleting(false);
    if (dbError) {
      setError(`Delete failed: ${dbError.message}`);
      setConfirmDelete(false);
      return;
    }
    handleClose();
    onSaved?.();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={handleClose} />

      <div className="relative z-10 w-full max-w-lg bg-white rounded-2xl shadow-xl max-h-[90vh] overflow-y-auto">
        <div className="px-6 pt-6 pb-8">
          <PlanSheetLabel />
          <div className="flex items-center justify-between mb-5">
            <h3 className="text-lg font-semibold text-gray-900">
              {isEdit ? 'Edit plan' : 'New plan'}
            </h3>
            <button onClick={handleClose} className="text-gray-400 hover:text-gray-600 p-1 -mr-1">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {saved ? (
            <div className="flex flex-col items-center py-10 space-y-3">
              <div className="w-12 h-12 bg-green-50 rounded-full flex items-center justify-center">
                <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <p className="text-sm font-semibold text-gray-900">
                {isEdit ? 'Plan updated' : 'Plan saved'}
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1.5">
                  Ticker <span className="text-red-400">*</span>
                </label>
                <div className="relative">
                  <input
                    type="text"
                    placeholder="AAPL, ES, EUR/USD..."
                    value={symbol}
                    onChange={ev => { setSymbol(ev.target.value); setSecSuggestOpen(true); }}
                    onFocus={() => { if (secSuggestions.length > 0) setSecSuggestOpen(true); }}
                    onBlur={() => setTimeout(() => setSecSuggestOpen(false), 150)}
                    className="w-full border border-gray-200 rounded-xl pl-4 pr-10 py-3 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-400 bg-gray-50 uppercase"
                  />
                  {symbol && (
                    <button
                      type="button"
                      onClick={handleClearSymbol}
                      aria-label="Clear ticker"
                      className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600 rounded hover:bg-gray-100"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  )}
                  {/* Autocomplete dropdown from securities table */}
                  {secSuggestOpen && secSuggestions.length > 0 && (
                    <div className="absolute z-20 mt-1 w-full bg-white rounded-lg shadow-lg border border-gray-100 max-h-56 overflow-y-auto">
                      {secSuggestions.map(sec => (
                        <button
                          key={sec.conid}
                          type="button"
                          onMouseDown={e => { e.preventDefault(); handleSelectSecurity(sec); }}
                          className="block w-full text-left px-4 py-2.5 hover:bg-gray-50 border-b border-gray-50 last:border-0"
                        >
                          <div className="flex items-baseline gap-2">
                            <span className="text-sm font-semibold text-gray-900">{sec.symbol}</span>
                            {sec._userRelevant && (
                              <span className="text-[10px] font-semibold uppercase tracking-wide text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded">
                                Recent
                              </span>
                            )}
                            <span className="text-xs text-gray-400">{sec.asset_category}</span>
                            {sec.currency && (
                              <span className="text-xs text-gray-400">{sec.currency}</span>
                            )}
                            {sec.company_name && (
                              <span className="text-xs text-gray-700 truncate">{sec.company_name}</span>
                            )}
                          </div>
                          {sec.description && sec.description !== sec.company_name && (
                            <p className="text-xs text-gray-400 truncate mt-0.5">{sec.description}</p>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Instrument info card — shows when a security is matched */}
                {selectedSecurity && (
                  <div className="mt-2 flex items-center gap-2 px-3 py-2 bg-blue-50 border border-blue-100 rounded-lg text-xs">
                    <span className="font-semibold text-blue-800">{selectedSecurity.symbol}</span>
                    <span className="px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 font-medium">{selectedSecurity.asset_category}</span>
                    {selectedSecurity.description && (
                      <span className="text-blue-600 truncate">{selectedSecurity.description}</span>
                    )}
                    {selectedSecurity.currency && (
                      <span className="ml-auto text-blue-700 font-semibold shrink-0">{selectedSecurity.currency}</span>
                    )}
                  </div>
                )}

                {histTrades.length > 0 && (() => {
                  const wins = histTrades.filter(t => pnlBase(t) > 0).length;
                  const losses = histTrades.length - wins;
                  const totalPnl = histTrades.reduce((sum, t) => sum + pnlBase(t), 0);
                  const totalQty = histTrades.reduce((sum, t) => sum + (t.total_closing_quantity || t.total_opening_quantity || 0), 0);
                  const weightedEntry = histTrades.reduce((sum, t) => {
                    const q = t.total_closing_quantity || t.total_opening_quantity || 0;
                    return sum + (t.avg_entry_price || 0) * q;
                  }, 0);
                  const avgEntry = totalQty > 0 ? weightedEntry / totalQty : null;
                  const tradeCurrency = histTrades[0]?.currency || baseCurrency;

                  return (
                    <div className="mt-2">
                      <button
                        type="button"
                        onClick={() => setHistExpanded(x => !x)}
                        className="w-full text-left"
                      >
                        <p className="text-xs text-gray-400 leading-relaxed">
                          <span className="text-gray-500 font-medium">{histTrades.length} trade{histTrades.length !== 1 ? 's' : ''}</span>
                          {' · '}
                          <span className="text-green-600">{wins}W</span>
                          {' / '}
                          <span className="text-red-500">{losses}L</span>
                          {avgEntry != null && <> · avg entry {fmtPrice(avgEntry, tradeCurrency)}</>}
                          {' · '}
                          {isPrivate
                            ? <span className="tracking-widest">••••</span>
                            : <span className={totalPnl >= 0 ? 'text-green-600' : 'text-red-500'}>{fmtPnl(totalPnl, baseCurrency, 0)}</span>
                          }
                        </p>
                      </button>

                      {histExpanded && (
                        <div className="mt-2 border border-gray-100 rounded-xl overflow-hidden">
                          {histTrades.map(t => {
                            const q = t.total_closing_quantity || t.total_opening_quantity || 0;
                            const isLong = t.direction === 'LONG';
                            const tPnl = pnlBase(t);
                            // Multiplier-aware reverse-engineered exit: for
                            // options/futures, P&L is in dollars already
                            // (qty × multiplier × priceDiff), so divide by
                            // (qty × multiplier) to back out a per-share
                            // price. Equities (multiplier=1) behave as
                            // before.
                            const tMult = parseFloat(t.multiplier) || 1;
                            const exit = (t.avg_entry_price != null && q > 0 && t.total_realized_pnl != null)
                              ? (isLong
                                  ? t.avg_entry_price + t.total_realized_pnl / (q * tMult)
                                  : t.avg_entry_price - t.total_realized_pnl / (q * tMult))
                              : null;
                            const dur = calcDuration(t.opened_at, t.closed_at);
                            const tCurrency = t.currency || baseCurrency;
                            return (
                              <div key={t.id} className="flex items-center gap-2 px-3 py-2 text-xs border-b border-gray-50 last:border-0 bg-white">
                                <span className="text-gray-400 w-12 shrink-0">{fmtDate(t.closed_at)}</span>
                                <span className={`px-1.5 py-0.5 rounded font-medium shrink-0 ${isLong ? 'bg-blue-50 text-blue-600' : 'bg-red-50 text-red-500'}`}>
                                  {t.direction}
                                </span>
                                <span className="text-gray-600">{fmtPrice(t.avg_entry_price, tCurrency)}</span>
                                <span className="text-gray-300">→</span>
                                <span className="text-gray-600">{exit != null ? fmtPrice(exit, tCurrency) : 'N/A'}</span>
                                <span className={`font-medium ml-auto shrink-0 ${tPnl >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                                  {isPrivate ? '••••' : fmtPnl(tPnl, tCurrency, 0)}
                                </span>
                                {dur && <span className="text-gray-400 shrink-0">{dur}</span>}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1.5">
                  Strategy
                </label>
                <select
                  value={strategy}
                  onChange={ev => setStrategy(ev.target.value)}
                  className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-gray-50 text-gray-700"
                >
                  <option value="">Select a strategy...</option>
                  {strategies.map(group => (
                    <optgroup key={group.group} label={group.group}>
                      {group.options.map(opt => (
                        <option key={opt}>{opt}</option>
                      ))}
                    </optgroup>
                  ))}
                  <option value="other">Other (custom)...</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1.5">
                  Direction <span className="text-red-400">*</span>
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => setDirection('long')}
                    className={`py-3 rounded-xl text-sm font-semibold border transition-colors ${
                      direction === 'long'
                        ? 'border-transparent bg-green-50 text-green-700 border-green-300'
                        : 'border-gray-200 bg-white text-gray-400'
                    }`}
                  >
                    &#9650; Long
                  </button>
                  <button
                    onClick={() => setDirection('short')}
                    className={`py-3 rounded-xl text-sm font-semibold border transition-colors ${
                      direction === 'short'
                        ? 'border-transparent bg-red-50 text-red-600 border-red-300'
                        : 'border-gray-200 bg-white text-gray-400'
                    }`}
                  >
                    &#9660; Short
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1.5">
                  Entry price <span className="text-red-400">*</span>
                </label>
                <input
                  type="number"
                  placeholder="0.00"
                  value={entry}
                  onChange={ev => setEntry(ev.target.value)}
                  className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-gray-50"
                />
              </div>

              <div className="border-t border-gray-100 pt-4">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Optional</p>
                <div className="grid grid-cols-3 gap-2 mb-3">
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Target</label>
                    <input type="number" placeholder="0.00" value={target} onChange={ev => setTarget(ev.target.value)}
                      className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-gray-50" />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Stop loss</label>
                    <input type="number" placeholder="0.00" value={stop} onChange={ev => setStop(ev.target.value)}
                      className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-gray-50" />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Quantity</label>
                    <input type="number" placeholder="0" value={qty} onChange={ev => setQty(ev.target.value)}
                      className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-gray-50" />
                  </div>
                </div>

                {showCalc && (
                  <div className="grid grid-cols-4 gap-2 bg-gray-50 rounded-xl p-3 border border-gray-100 mb-3">
                    <div className="text-center"><p className="text-xs text-gray-400 mb-1">Position</p><p className="text-sm font-semibold text-gray-700">{posSize}</p></div>
                    <div className="text-center"><p className="text-xs text-gray-400 mb-1">Risk</p><p className="text-sm font-semibold text-red-500">{risk}</p></div>
                    <div className="text-center"><p className="text-xs text-gray-400 mb-1">Reward</p><p className="text-sm font-semibold text-green-600">{reward}</p></div>
                    <div className="text-center"><p className="text-xs text-gray-400 mb-1">R:R</p><p className={`text-sm font-semibold ${rrColor}`}>{rr}</p></div>
                  </div>
                )}

                <textarea
                  placeholder="Thesis / notes -- why are you taking this trade?"
                  rows={2}
                  value={thesis}
                  onChange={ev => setThesis(ev.target.value)}
                  className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-gray-50 resize-none"
                />
              </div>

              {error && (
                <div className="bg-red-50 border border-red-100 rounded-xl px-4 py-3 text-sm text-red-600">
                  {error}
                </div>
              )}

              <button
                onClick={handleSave}
                disabled={saving}
                className="w-full bg-blue-600 text-white font-semibold py-3.5 rounded-xl text-sm hover:bg-blue-700 transition-colors disabled:opacity-50"
              >
                {saving ? 'Saving...' : isEdit ? 'Save changes' : 'Save plan'}
              </button>

              {isEdit && (
                matchedCount > 0 ? (
                  <div className="w-full font-medium py-3 px-4 rounded-xl text-xs text-center border border-gray-200 bg-gray-50 text-gray-500">
                    Can't delete — {matchedCount} trade{matchedCount !== 1 ? 's' : ''} matched to this plan.
                    <br />
                    Reset those matches in Smart Journal first.
                  </div>
                ) : (
                  <button
                    onClick={handleDelete}
                    disabled={deleting}
                    className={`w-full font-semibold py-3 rounded-xl text-sm transition-colors disabled:opacity-50 ${
                      confirmDelete
                        ? 'bg-red-600 text-white hover:bg-red-700'
                        : 'border border-red-200 text-red-500 hover:bg-red-50'
                    }`}
                  >
                    {deleting ? 'Deleting...' : confirmDelete ? 'Tap again to confirm delete' : 'Delete plan'}
                  </button>
                )
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

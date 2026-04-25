# Whole-code audit — CT3000

**Original audit date:** 2026-04-18. **Last reconciled:** 2026-04-25
(annotations + path corrections + RESOLVED markers).
Scope: all `src/`, `api/`, core docs. Excludes `supabase/migrations/*`
(historical) and build artifacts.

**Method:** three parallel explore agents (logic, security, UX) each dumped ~20-25 findings. I verified the high-impact claims by reading the code myself and discarded the false positives (pattern-matched security clichés). What's left below is things I have high confidence in.

**TL;DR for beta readiness:** only one BLOCKING logic bug (dead code that's misleading but not active). Everything else is MEDIUM/LOW — ship the beta, fix these in the first post-beta sprint. Sentry will surface anything we missed.

---

## BLOCKING

### 1. Dead code + misleading comment in FIFO builder's C;O branch

**Where (current path):** `api/_lib/logicalTradeBuilder.js`. The historical `src/lib/logicalTradeBuilder.js` was deleted; FIFO is server-only now.

**Original finding:** two identically-filtered variables in the C;O reversal branch (`closeTrades` + an unused `openTrades`). Misleading comment about "different qty split" with no actual split logic.

**Status (2026-04-25):** behaviour-correctness for reversal trades is still a known approximation. The current builder treats the C;O group as "close N, then open N" using the whole group's quantity. For most users this is fine; for traders who do same-fill reversals it can mis-attribute small qty deltas. The standalone `logical_trade_executions` join table that *would* hold the precise per-LT split was empty in prod and has been dropped (see BACKLOG / today's commits).

**Fix path going forward:** if reversal precision becomes important, repopulate per-(trade, LT) `quantity_applied` data from `rebuildForUser` and use it in client-side position math. Not blocking the modern code path; flag is retained for visibility.

---

## HIGH

### 2. ~~Two copies of `logicalTradeBuilder.js` / `adherenceScore.js` — guaranteed drift~~ ✅ RESOLVED

**Status:** Both cleaned up April 2026.
- `src/lib/logicalTradeBuilder.js` was dead code (zero importers) — deleted outright. Browser never runs FIFO; all rebuilds happen server-side in `api/_lib/logicalTradeBuilder.js` via `api/_lib/rebuildForUser.js` (called inline by `/api/sync` and exposed standalone via `/api/rebuild`).
- `src/lib/adherenceScore.js` was actively used by three browser files, but only to recompute what the server had already written to `logical_trades.adherence_score`. Browser now reads the DB column directly (Journal, TradeInlineDetail, PerformanceScreen); the browser copy was deleted and `api/_lib/adherenceScore.js` simplified to a single scalar function. The Performance screen's 4-bar "Adherence breakdown" panel was dropped at the same time — the overall "Avg adherence" KPI card remains.

---

### 3. `rebuild` is not atomic: delete-then-insert with no transaction

**Where (current path):** `api/_lib/rebuildForUser.js` (the rebuild logic moved out of `api/rebuild.js` into the shared helper; `api/rebuild.js` now just calls it).

Already documented in `LIMITS-AUDIT.md` finding #3. Re-flagged here because it's the single most likely way a beta user loses data. Delete succeeds → insert fails (timeout, payload limit, schema mismatch) → user's `logical_trades` is empty until they re-sync successfully. Sentry will catch the error but the damage is done.

**Fix:** stage into a temp structure and swap, or run as a Postgres RPC inside `BEGIN/COMMIT`. Half a day.

---

### 4. `fmtShort` silently defaults currency to `'USD'`

**Where:** `src/lib/formatters.js` (line number ~48 per the audit)

CLAUDE.md says formatting helpers must NEVER default currency — the whole point is that missing-currency bugs surface visibly (`¤` / `—`), not silently as a USD `$`. `fmtShort` (used on chart axes in PerformanceScreen) violates this and will silently render `$1.2k` for a GBP/EUR/JPY trader if the currency variable is nullish at the call site.

**User impact:** non-USD beta users see wrong currency symbols on chart tick marks. Confusing, looks like a translation bug.

**Fix:** remove the `= 'USD'` default parameter; force callers to pass it; callers that don't have it should pass `null` and accept the fallback glyph.

---

### 5. No bailout when `Promise.all` rejects on data-load screens

**Where:** `src/screens/PlansScreen.jsx:24-45` (my own code from the previous session — mea culpa), probably other `useEffect(load)` patterns across the codebase.

```js
const [plansRes, matchedRes] = await Promise.all([...]);
// ...
setLoading(false);
```

If either Supabase call rejects (not returns an error object — actually rejects, e.g., network failure), the `await` throws, control exits the `load` function, `setLoading(false)` never runs, spinner spins forever. No error state, no retry button.

**User impact:** screen hangs on loading spinner if Supabase hiccups.

**Fix:** wrap in `try/finally`, set an error state in catch, show a retry affordance. Should be done for every "loading screen" pattern in the app — audit all of them in one pass.

---

### 6. Stale `planned_trade_id` on trades when a plan is deleted

**Where (current path):** `api/_lib/rebuildForUser.js` — `applyPlanMatching()` and the user_reviewed preservation block.

If a user deletes a plan via direct Supabase call (or if the PlanSheet delete path has no `matchedCount > 0` block — we didn't verify), matched `logical_trades.planned_trade_id` values still point at the now-nonexistent plan row. Rebuild preserves these on user_reviewed trades, so they can outlive the plan.

**User impact:** a trade shows "matched to plan" in the UI but the plan is gone, and adherence lookups fail.

**Fix:** either add a FK with `ON DELETE SET NULL` on `logical_trades.planned_trade_id`, or in rebuild add a "does this planned_trade_id still exist?" check. Schema change is cleaner — a 1-line migration.

---

## MEDIUM

### 7. ~~`anonymous_sessions` table never cleaned up~~ ✅ RESOLVED

The whole anonymous-user flow was retired 2026-04-20. Table dropped via `supabase/migrations/20260420_drop_anonymous_sessions.sql`. Nothing to clean up.

---

### 8. Stripe webhook has no replay protection (but it's idempotent by accident)

**Where:** `api/stripe-webhook.js:39-113`

No check on `event.id` against a seen-events table. Stripe's retry policy means a webhook that returns non-2xx gets replayed up to 3 days later. Our handler uses `upsert` with `onConflict: 'user_id'` on `checkout.session.completed`, so a replay writes the same values. That makes it *accidentally* idempotent for this event type, but it's fragile — any future handler that does an `insert` or an incrementing update will silently double-apply.

**Where it actually matters today:** not in production. Pre-beta 10 users won't hit this.

**Fix (post-beta):** new table `processed_stripe_events(event_id PK, received_at)`. At webhook entry, `insert` it; if it fails with unique violation, return `{ received: true }` without processing.

---

### 9. IBKR token stored in plaintext in `user_ibkr_credentials.ibkr_token`

**Where:** schema. Token is a sensitive credential with full trading access.

RLS protects it from anon-key reads, but any Supabase admin with dashboard access can read every user's token. Pre-beta: acceptable (Antonis has admin, trusts himself). Public beta: not acceptable — should be encrypted at rest via `pgsodium` or rotated to a short-lived OAuth flow (IBKR doesn't offer this cleanly, so encryption is the realistic path).

**User impact (if breached):** attacker can run Flex Queries against victim accounts, get full trading history.

**Fix:** `pgsodium` column encryption, decrypt only inside sync.js with a key loaded from Vercel env. Post-beta.

---

### 10. `admin_actions` table is declared but never written to

**Where:** schema. No code in `api/*.js` or the separate `ct3000-admin` repo (per the handoff) actually writes to this.

Means any admin action taken via the admin UI leaves no audit trail. For beta users under NDA this is fine; when you have paying customers and need to answer "why did my account get disabled," you need the trail.

**Fix:** wire every admin mutation through a helper that `insert`s into `admin_actions` first. Post-beta.

---

### 11. Silent Supabase errors across multiple screens

The error-checking convention in the codebase is inconsistent. Some places use `if (error) setSomeError(error.message)`, others `console.error` and swallow, others just destructure `{ data }` and ignore `error` entirely.

Note: line numbers on the original concrete instances are stale (the `DailyViewScreen.handleResolve` cited has been removed; the trade resolution UX moved to `ReviewScreen`). The general pattern still exists across screens; needs one consistency pass.

**User impact:** user takes an action, nothing happens, no way to know why. Looks broken.

**Fix:** one pass to standardize. Decide on a single pattern (e.g., `if (error) toast.error(error.message)`) and apply uniformly. Medium-size refactor, 3-4 hours.

**Current standard:** the documented "Data-loading pattern" in `CLAUDE.md` (try/catch around the load function, `LoadError` retry surface, Sentry context tagging) is the target shape. Most screens conform; an audit pass would find the stragglers.

---

### 12. ~~Timestamp normalization strips timezone offset instead of converting~~ — RESOLVED

**Then:** `src/lib/logicalTradeBuilder.js` (since deleted) had a slice-and-append that asserted UTC on whatever string it received.

**Now:** the FIFO builder lives only at `api/_lib/logicalTradeBuilder.js`. The trade-time pipeline is:
- `api/_lib/exchangeTimezone.js` maps IBKR venue → IANA tz.
- `ibkrDateToUtcIso(dateTime, exchange)` in `performUserSync` parses the
  IBKR `YYYYMMDD;HHMMSS` value as exchange-local wall clock and converts
  to a real UTC ISO string before persisting.
- `trades.exchange` is now stored alongside the timestamp.

Historical rows were re-interpreted via
`supabase/migrations/20260425_backfill_trade_timezones.sql`.

---

### 13. Account ID visible in Settings (flag for future)

**Where:** `src/screens/SettingsScreen.jsx`

UX agent flagged this as a privacy leak. **It's not — the user is viewing their own account ID in their own settings.** That's showing the user what they already own. Flagging in case you ever add a "share settings screenshot" feature or if IBKR account IDs are considered sensitive to screen-record (unlikely, but product call).

**No fix needed.** Just noting so it doesn't get flagged again.

---

## LOW

### 14. `DailyViewScreen` redundant CASH check

`const isFX = row.assetCategory === 'FXCFD' || row.assetCategory === 'CASH'` — CASH is already filtered out in logicalTradeBuilder, so `row.assetCategory === 'CASH'` is unreachable. Cosmetic cleanup.

### 15. HomeScreen counts breakeven trades as losses

`pnl > 0` = win, `pnl <= 0` = loss. A trade that closed exactly at breakeven (rare but possible, especially for scratches) gets counted as a loss. Downward-biased win rate. Low impact, but worth `pnl >= 0` as the win test (or `!= 0 &&` for explicit no-breakeven counting).

### 16. ~~Sidebar win rate + "this month" stats are hardcoded `--`~~ ✅ RESOLVED

Sidebar wiring updated; placeholders replaced with real values.

### 17. PerformanceScreen empty-state could have a CTA

"No closed trades in this period" gives no next action. Could say "Try a wider period" or "Import trades via IBKR." Pure UX polish.

### 18. ~~Sync response returns the full trades array then client reuploads it~~ ✅ RESOLVED

`/api/sync` is now server-authoritative. Server upserts trades + replaces open_positions + updates credentials + rebuilds logical trades, all via `service_role`. Browser receives only a summary (`{ tradeCount, openPositionCount, logicalCount, newTradeCount, newTradesPreview, rebuildWarnings }`) and renders it. See `docs/backend.md` and `api/_lib/performUserSync.js` for the new flow.

---

## Things I verified as FALSE POSITIVES (so you don't re-investigate)

The agents flagged these — I read the code and they're wrong:

- **"Stripe metadata override attack"** — `create-checkout-session.js:54,84` uses `user.id` from the JWT-verified Supabase token, not from request body. An attacker can't inject someone else's user_id into metadata.
- **"XSS via IBKR trade notes"** — React's JSX auto-escapes interpolated strings; nothing renders trade.notes via `dangerouslySetInnerHTML`. Safe.
- **"CSRF on Supabase mutations"** — Supabase uses JWT in Authorization header, not cookies, so CSRF isn't applicable.
- **"Double-click hazard on Sync button"** — `disabled={syncing || rebuilding}` is set on the button. Safe.
- **"Orphan trade direction inverted (line 231)"** — `firstTrade.buy_sell === 'SELL' ? 'LONG' : 'SHORT'` is correct. A SELL execution closes a LONG; the orphan direction should be LONG.
- **"No rate limiting on /api/sync"** — technically true, but IBKR's own rate limits + Vercel's per-user function concurrency cap make DoS impractical. Not a beta blocker.

---

## Status of recommended execution order

This list was written for "before beta" planning and is now mostly
historical. Updated status:

| Item | Original priority | Status |
|---|---|---|
| #2 — dedupe builder copies | high | ✅ done (FIFO is server-only) |
| #18 — server-authoritative sync | high | ✅ done (`performUserSync`) |
| #12 — timestamp normalization | high | ✅ done (`exchangeTimezone.js`) |
| #16 — sidebar hardcoded stats | low | ✅ done |
| #1 — C;O builder dead code | blocking | partial — see updated note above |
| #4 — `fmtShort` default currency | high | TBD/needs verification (formatters.js content not re-checked in this pass) |
| #5 — `try/finally` on data loads | high | mostly done (CLAUDE.md "Data-loading pattern" is the standard; spot-check stragglers) |
| #3 — rebuild atomic delete-then-insert | high | open |
| #6 — FK on `planned_trade_id` | high | open |
| #11 — silent-error consistency | medium | partial / open |
| #8 — Stripe webhook event dedup | medium | open |
| #9 — IBKR token encryption at rest | medium | open (write-side closed via `/api/ibkr-credentials` + grants; rest-encryption still TODO) |
| #10 — wire `admin_actions` | medium | open |

---

**Not touched in this audit (future work):**
- Performance profiling of the FIFO builder under 10k+ trade input
- Actual data migration for trades that might have stale match state pre-fix
- Accessibility beyond color-only indicators (keyboard nav, screen reader)
- E2E tests (there aren't any in the repo — biggest missing safety net)

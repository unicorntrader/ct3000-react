# Whole-code audit — CT3000

**Date:** 2026-04-18. Scope: all `src/`, `api/`, core docs. Excludes `supabase/migrations/*` (historical) and build artifacts.

**Method:** three parallel explore agents (logic, security, UX) each dumped ~20-25 findings. I verified the high-impact claims by reading the code myself and discarded the false positives (pattern-matched security clichés). What's left below is things I have high confidence in.

**TL;DR for beta readiness:** only one BLOCKING logic bug (dead code that's misleading but not active). Everything else is MEDIUM/LOW — ship the beta, fix these in the first post-beta sprint. Sentry will surface anything we missed.

---

## BLOCKING

### 1. Dead code + misleading comment in FIFO builder's C;O branch

**Where:** `src/lib/logicalTradeBuilder.js:130-131` (and the equivalent spot in `api/lib/logicalTradeBuilder.js`)

```js
const closeTrades = group.filter(t => (t.open_close_indicator || '') === 'C;O');
const openTrades  = group.filter(t => (t.open_close_indicator || '') === 'C;O'); // same trades, different qty split
```

Two variables, identical filters. `openTrades` is **never referenced** after this line. The comment claims "different qty split" but there's no split logic — the C;O branch treats the whole group as one close followed by one open, and the new "open side" on line 162 uses `group` (not `openTrades`).

**Why blocking:** not a behavior bug *right now* (openTrades is dead code), but it's a landmine. Anyone reading this file will assume the two variables are doing different things and will modify one without the other, introducing a real bug. Also: this code ran on your CRWV trade history in the "truth-first SJ accounting" session and produced correct-looking output, which suggests the C;O path hasn't actually been stress-tested under realistic data.

**Fix:** delete `openTrades`; fix the comment; actually think through whether we need to separate close-qty from open-qty (IBKR's `C;O` reversal semantics imply you might).

---

## HIGH

### 2. ~~Two copies of `logicalTradeBuilder.js` / `adherenceScore.js` — guaranteed drift~~ ✅ RESOLVED

**Status:** Both cleaned up April 2026.
- `src/lib/logicalTradeBuilder.js` was dead code (zero importers) — deleted outright. Browser never runs FIFO; all rebuilds happen server-side in `api/lib/logicalTradeBuilder.js` via `api/rebuild.js`.
- `src/lib/adherenceScore.js` was actively used by three browser files, but only to recompute what `api/rebuild.js` had already written to `logical_trades.adherence_score`. Browser now reads the DB column directly (Journal, TradeInlineDetail, PerformanceScreen); the browser copy was deleted and `api/lib/adherenceScore.js` simplified to a single scalar function. The Performance screen's 4-bar "Adherence breakdown" panel was dropped at the same time — the overall "Avg adherence" KPI card remains.

---

### 3. `rebuild` is not atomic: delete-then-insert with no transaction

**Where:** `api/rebuild.js:186-202`

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

**Where:** `api/rebuild.js:28-70` (`applyPlanMatching`), preservation logic at `api/rebuild.js:140-156`

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

The error-checking convention in the codebase is inconsistent. Some places use `if (error) setSomeError(error.message)`, others `console.error` and swallow, others just destructure `{ data }` and ignore `error` entirely. Concrete instances the UX agent flagged (not individually verified, but representative):

- `src/screens/DailyViewScreen.jsx:519-525` — `handleResolve` silently returns on error
- `src/screens/JournalScreen.jsx:173-182` — `loadPlaybooks` logs and shows empty state
- `src/screens/SettingsScreen.jsx:45-62` — sets error state but no retry button

**User impact:** user takes an action, nothing happens, no way to know why. Looks broken.

**Fix:** one pass to standardize. Decide on a single pattern (e.g., `if (error) toast.error(error.message)`) and apply uniformly. Medium-size refactor, 3-4 hours.

---

### 12. Timestamp normalization strips timezone offset instead of converting

**Where:** `src/lib/logicalTradeBuilder.js:64-78` (and server copy)

```js
const core = dt.slice(0, 19);     // "2026-04-18T10:30:45"
return `${core}Z`;                 // "2026-04-18T10:30:45Z" — asserts UTC
```

If the input was `"2026-04-18T10:30:45-05:00"` (EST), we slice off the offset and label it UTC — the stored time is effectively shifted by 5 hours.

**Does it matter in practice?** IBKR Flex XML emits the compact `YYYYMMDD;HHMMSS` format without any timezone. `sync.js`'s `ibkrDateToIso` converts those to `"YYYY-MM-DDTHH:MM:SS"` (no offset) before storing. Our own round-trip produces no offset, so the strip doesn't bite on IBKR-sourced data. It only bites if some other code path ever inserts an offset-bearing timestamp — today, nothing does.

**Fix:** cheap defensive check — `new Date(dt).toISOString()` instead of the slice-and-append. Handles both offset and non-offset inputs. 10 minutes.

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

### 16. Sidebar win rate + "this month" stats are hardcoded `--`

Documented in SETUP.md known gaps. Still present. Either wire real data or remove the fields.

### 17. PerformanceScreen empty-state could have a CTA

"No closed trades in this period" gives no next action. Could say "Try a wider period" or "Import trades via IBKR." Pure UX polish.

### 18. Sync response returns the full trades array then client reuploads it

Already in `LIMITS-AUDIT.md` finding #7. Listed here to keep the backlog aware.

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

## Recommended execution order

**Before beta (this week):**
1. #1 — delete `openTrades` dead code + think through C;O split
2. #4 — remove `fmtShort` default currency
3. #5 — `try/finally` wrapper on the loading useEffects (at minimum PlansScreen since I just wrote it)

**First post-beta sprint:**
4. #3 — rebuild transaction/swap
5. #6 — FK cascade on planned_trade_id
6. #11 — silent-error audit pass

**Post-launch backlog:**
8. #2 — dedupe the two logicalTradeBuilder.js files
9. #8 — webhook event dedup
10. #9 — IBKR token encryption at rest
11. #10 — wire admin_actions

---

**Not touched in this audit (future work):**
- Performance profiling of the FIFO builder under 10k+ trade input
- Actual data migration for trades that might have stale match state pre-fix
- Accessibility beyond color-only indicators (keyboard nav, screen reader)
- E2E tests (there aren't any in the repo — biggest missing safety net)

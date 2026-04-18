# Scale & limits audit — CT3000 pre-beta

**Audited:** 2026-04-18, ahead of the 10-user beta launch.
**Scope:** IBKR sync flow, Supabase query patterns, browser render budget, observability.
**Question asked:** *"If a user has too many trades, does he get a clear error? Do we have intelligence to see what breaks?"*

**TL;DR:** No to both. A heavy user today would likely see **silent truncation** (Supabase's default 1000-row cap applies to every `.select()` we make) or a **vague 500** from the sync function with no breadcrumb for us on the server side. We have `console.error` and nothing else — no Sentry, no PostHog, no telemetry. Of the ten users, the first one with >1000 raw trades trips at least one of these today.

---

## How the sync flow actually works (confirmed)

```
Browser IBKRScreen.handleSync
    │
    ├─ POST /api/sync  (Vercel serverless)
    │     ├─ IBKR SendRequest
    │     ├─ IBKR GetStatement (poll up to 10× × 3s = 30s)
    │     ├─ Regex-parse entire XML
    │     ├─ Clear demo rows
    │     └─ Returns full trades[] + openPositions[] as JSON
    │
    ├─ supabase.from('trades').upsert(tradesToUpsert)   ← single call, all rows
    ├─ supabase.from('open_positions').delete + insert
    ├─ supabase.from('user_ibkr_credentials').update(last_sync_at)
    │
    └─ POST /api/rebuild  (Vercel serverless)
          ├─ .from('trades').select('*')                ← 1000-row cap applies
          ├─ .from('logical_trades').select(...)        ← 1000-row cap applies
          ├─ buildLogicalTrades() in memory
          ├─ .from('planned_trades').select('*')
          ├─ .from('logical_trades').delete(user_id=…)
          └─ .from('logical_trades').insert(logical)    ← single call
```

The client doing the DB writes is a quirk of this flow — sync.js parses and *returns* the trades; the browser writes them. That means **two** timeout surfaces (sync function + browser network) and **two** places the user can lose connectivity mid-write.

---

## [BLOCKING FOR BETA]

### 1. Supabase default row cap (1000) applies everywhere
**Where:** every `.select()` in the app. Worst offenders:
- `api/rebuild.js:93` — `.from('trades').select('*').eq('user_id', userId)` — silently truncates raw trades for anyone with >1000 IBKR executions. Rebuild then produces logical_trades from a partial dataset.
- `src/screens/JournalScreen.jsx:203` — `.from('logical_trades').select('*')` — journal goes blind to older trades.
- `src/screens/PerformanceScreen.jsx:143` — `.from('logical_trades').select('*')` — P&L curve truncates.
- `src/screens/HomeScreen.jsx:39` — `.from('logical_trades').select(...)` — pipeline counts wrong.

**What the user sees:** Nothing. The P&L curve flattens after some arbitrary date, pipeline counts are low, rebuild omits trades. No error.
**Trigger:** first user with >1000 raw IBKR executions. That is *very* low for an active day trader — a few weeks of activity.
**Fix sketch:** either raise the project-wide `db.settings.max_rows` in Supabase (simplest), or add `.range(0, 9999)` / paginate per query.

### 2. No `maxDuration` set on Vercel functions
**Where:** `vercel.json` has no `functions` block. Hobby default is 10s, Pro default is 60s.
**Risk:** `getStatement` alone polls up to 10 × 3s = **30 s** on a cold IBKR queue. On Hobby this 504s guaranteed. Even on Pro, a large XML parse + demo cleanup can push past 60s.
**What the user sees:** Vercel returns 504 (HTML error page), client `JSON.parse` fails, toast says *"HTTP 504 — non-JSON response: <!DOCTYPE …"*. Unclear the function timed out.
**Fix sketch:** set `"functions": { "api/sync.js": { "maxDuration": 60 }, "api/rebuild.js": { "maxDuration": 60 } }` in `vercel.json` (Pro plan). Alternatively cut `getStatement` retries or move to streaming.

### 3. No rebuild transaction — users can end up with zero logical trades
**Where:** `api/rebuild.js:186-197` — delete then insert, no transaction wrapping, no savepoint.
**Risk:** if the insert fails (timeout, payload too large, schema mismatch), the user's `logical_trades` table is now empty. Home/Journal/Performance all show "no trades" until they re-run sync + rebuild.
**What the user sees:** "Rebuild failed: <error>" toast AND empty app. Looks catastrophic. Our fault, their panic.
**Fix sketch:** build into a staging table and swap, or use a Postgres RPC with transaction semantics, or at minimum snapshot the deleted rows to a temp structure to restore on failure.

### 4. ~~No observability — we won't know beta users are breaking~~ ✅ RESOLVED
**Status:** Sentry wired for both browser (`@sentry/react`) and serverless (`@sentry/node` via `api/lib/sentry.js`). ErrorBoundary reports crashes; IBKRScreen captures sync-step failures with tags (`sync_step=flex-fetch | trades-upsert | positions-insert | credentials-update | logical-rebuild`); `api/sync.js` and `api/rebuild.js` capture unhandled errors with `route` + `sync_step` tags and flush before responding. User context (Supabase `user_id`, email for non-anon) is attached to every event.
**Remaining:** add `REACT_APP_SENTRY_DSN` + `SENTRY_DSN` env vars in Vercel. Consider a Slack webhook alert on 5xx in the Sentry project settings.

---

## [HITS AT N USERS/TRADES]

### 5. Single `.upsert(tradesToUpsert)` from the browser
**Where:** `src/screens/IBKRScreen.jsx:183-185`.
**Risk:** Supabase/PostgREST has a ~1MB default request-body limit on some deployments. 5k trades × ~600 bytes JSON each ≈ 3MB. Will 413 or silently truncate.
**Trigger:** ~3–5k new trades in a single sync (i.e. first sync for a heavy trader).
**What the user sees:** "Trades save failed: Payload too large" or similar — message exists but gives no guidance.
**Fix sketch:** batch the upsert in chunks of 500.

### 6. Single `.insert(logical)` in rebuild
**Where:** `api/rebuild.js:195-197`. Same issue as above, server-side.
**Trigger:** roughly 5k+ logical trades.
**Fix sketch:** batch in chunks of 500.

### 7. JSON response from `/api/sync` includes entire trades array
**Where:** `api/sync.js:265-273`.
**Risk:** for a user with 20k executions, the Vercel function returns 10+ MB of JSON to the browser. Slow on mobile, potentially exceeds any intermediate proxy limit.
**Fix sketch:** move the DB writes into sync.js itself (server-side), return a count, not the data.

### 8. XML parse + entire-document-in-memory
**Where:** `api/sync.js:14-22` (fetch), `api/sync.js:113-150` (regex parse).
**Risk:** OK to about 100k trades (~20MB XML). Vercel serverless memory default is 1024MB, plenty for now. But memory scales linearly with trade count.
**Fix sketch:** not urgent. If we ever hit whale users, switch to a streaming XML parser (sax-js or fast-xml-parser streaming).

### 9. No virtualization on JournalScreen's trade list
**Where:** `src/screens/JournalScreen.jsx:710` — `filtered.map(trade => …)`.
**Risk:** each row is a reasonably heavy component (filter pills, expand handler, bulk-select checkbox, etc). Gets laggy around 2–5k rendered rows, unusable around 10k.
**Trigger:** a user who imports 2+ years of day-trading history and picks "All" date range.
**Fix sketch:** `react-window` or similar. Medium effort.

### 10. FIFO builder is O(n) per closing trade group, but `Array.shift()` in the hot loop
**Where:** `src/lib/logicalTradeBuilder.js` — `.shift()` per matched lot.
**Risk:** not a real problem until ~50k+ executions. Shift is O(m) where m is open-positions-on-that-symbol, usually <10. Listing for completeness.
**Fix sketch:** skip; not worth optimising pre-beta.

---

## [COSMETIC / NICE TO FIX]

### 11. No step-by-step error breadcrumbs
`setSyncError(err.message)` swallows which step failed. User can't tell if the failure was at "fetching from IBKR" vs "saving to our DB."
**Fix sketch:** wrap each step in `try/catch` that prepends `[sync step 2/4: fetch XML]`.

### 12. Silent truncation warning would be valuable
Even if we raise the row cap to 10k, we should log a warning when we get exactly the cap back, because that probably means there's more.
**Fix sketch:** in the client, after a `.select()`, if `data.length === 1000`, `console.warn` + Sentry event.

### 13. `anonymous_sessions` never cleaned up
`expires_at` exists but no cron calls `DELETE ... WHERE expires_at < now()`. Not a scale-breaking issue — just bloats the table slowly.
**Fix sketch:** Supabase `pg_cron` job or a weekly Vercel cron endpoint.

### 14. Sync result shows what *sync* returned, not what was *stored*
`IBKRScreen.jsx:389` — `"{tradeCount} trades saved to database"` actually prints the count sync.js parsed, not what Supabase acknowledged. If upsert silently dropped rows, the UI lies.
**Fix sketch:** read back `.select('id', {count:'exact',head:true}).from('trades')` after the upsert.

---

## Recommended order of fixes

Pre-beta minimum (ship before the 10 users touch it):
1. **#1 — raise Supabase row cap** (one-line config change)
2. **#2 — set `maxDuration` in vercel.json** (one-line change)
3. ~~**#4 — Sentry on browser + Vercel**~~ ✅ shipped (requires DSN env vars in Vercel)
4. **#5 + #6 — batch the upserts** (half a day)

Post-beta, before broader launch:
5. **#3 — rebuild transaction** (half a day, non-trivial)
6. **#7 — move DB writes into sync.js** (one day)
7. **#11 + #12 — better error plumbing** (few hours)

Can wait:
8. #8, #9, #10, #13, #14

---

*Generated as part of the PR-to-SJ UX pass. See `docs/BACKLOG.md` for other pre-beta items.*

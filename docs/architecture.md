# Architecture

## System overview

CT3000 is a three-tier web application:

1. **React SPA** (Vite-built) — UI, routing, screen-level state, light reads from Supabase. Trade-data writes go through the API tier, not the browser.
2. **Vercel Serverless Functions** (`/api/*`) — handle the IBKR integration, paid-route gating, Stripe lifecycle, account deletion, scheduled crons, and IBKR-credential writes.
3. **Supabase** — PostgreSQL + email/password Auth + Row-Level Security and column-level grants.

There is no long-running backend server. The SPA talks directly to Supabase for reads and a small set of safe writes (daily notes, the auto-sync toggle, plan CRUD). Anything sensitive — IBKR token writes, trade persistence, subscription enforcement — flows through the API tier under `service_role`.

---

## Data flow diagram

```
┌──────────────────────────────────────────────────────────────────┐
│                        Browser (React SPA)                       │
│                                                                  │
│  AuthScreen ──── supabase.auth.signIn/signUp/resetPassword ──┐  │
│                                                               │  │
│  IBKRScreen ─── POST /api/sync (Bearer JWT, empty body) ──┐  │  │
│                ─── POST /api/ibkr-credentials (save) ─────┤  │  │
│                ─── DELETE /api/ibkr-credentials (remove) ─┤  │  │
│                                                            │  │  │
│  Screens ──── supabase.from('table').select() (RLS-       │  │  │
│               filtered reads); writes only on safe        │  │  │
│               surfaces (daily_notes, auto_sync_enabled,   │  │  │
│               planned_trades, playbooks, weekly_reviews)  │  │  │
└────────────────────────────────────────────────────────────┼──┼──┘
                                                             │  │
              ┌──────────────────────────────────────────────┘  │
              ▼                                                  │
┌──────────────────────────────────────┐  ┌─────────────────────────┐
│  /api/sync.js   (Vercel Node fn)     │  │  Supabase               │
│   - JWT auth                         │  │  (PostgreSQL + Auth)    │
│   - requireActiveSubscription gate   │  │                         │
│   - performUserSync(userId, admin):  │  │  Tables:                │
│     1. read IBKR creds (service_role)│  │   trades                │
│     2. SendRequest → IBKR Flex       │  │   logical_trades        │
│     3. Poll GetStatement (≤10×3s)    │  │   planned_trades        │
│     4. Reject Flex period > 35 days  │  │   open_positions        │
│     5. Parse XML → exchange-local    │  │   user_ibkr_credentials │
│        timestamp → real UTC          │  │   user_subscriptions    │
│     6. Diff incoming ib_exec_ids     │  │   daily_notes           │
│     7. Upsert trades                 │  │   account_deletions     │
│     8. Replace open_positions        │  │   ...                   │
│     9. Clear demo rows               │  │                         │
│    10. Update creds (last_sync_at +  │  │  Auth:                  │
│        account_id + base_currency)   │  │   users (managed)       │
│    11. rebuildForUser → logical_     │  │                         │
│        trades + plan match +         │  │  Grants:                │
│        adherence                     │  │   browser SELECT only   │
│   - Returns SUMMARY (counts +        │  │   on safe columns of    │
│     newTradesPreview), no raw rows   │  │   user_ibkr_credentials │
│                                      │  │   browser INSERT/UPDATE │
│  /api/ibkr-credentials.js            │  │   /DELETE blocked on    │
│   - POST {token, queryId}: validate, │  │   trade tables          │
│     mask, upsert via service_role    │  │                         │
│   - DELETE: remove creds row         │  │   service_role bypasses │
│                                      │  │   all of the above      │
│  /api/rebuild.js                     │  │                         │
│   - JWT + sub-gate, calls            │  │                         │
│     rebuildForUser                   │  │                         │
└─────────────────┬────────────────────┘  └──────────┬──────────────┘
                  │                                   │
                  ▼                                   │
   IBKR Flex Web Service                             │
   (gdcdyn.interactivebrokers.com)                   │
                                                     │
                ┌────────────────────────────────────┘
                │  After /api/sync returns the summary, the browser:
                │
                ▼
   - sets local lastSyncAt
   - bumps DataVersionContext keys ('trades', 'positions', 'ibkrCreds')
   - renders the new-fills count + preview list
   - silent-refetches happen on watching screens via the version bump
```

There is no client-side `.upsert(trades)` or `.insert(open_positions)`
on the modern code path; that's all server-side under `service_role`.

---

## Component responsibilities

### Entry points

| File | Responsibility |
|---|---|
| `src/index.jsx` | Mounts the React root into `#root`. Bundled by Vite — entry HTML is `/index.html` at repo root with a `<script type="module" src="/src/index.jsx">`. |
| `src/App.jsx` | Checks Supabase session; renders `AuthScreen` or `AppShell` |
| `src/App.jsx / AppShell` | Owns active tab state, sidebar/sheet visibility, `planRefreshKey`. Renders `Header`, `Sidebar`, `PlanSheet`, `ReviewSheet`, `MobileNav`, and the active screen. |

### Screens (tab-routed via `activeTab` string state)

| Tab ID | Screen file | What it does |
|---|---|---|
| `home` | `HomeScreen.jsx` | Shows 4 stat cards (today's P&L, open positions, active plans, 30d win rate), open positions list (sortable by size or date), active plans cards. Shows amber review banner when `unmatched`/`ambiguous` logical trades exist. |
| `plans` | `PlansScreen.jsx` | Lists all `planned_trades` ordered by `created_at` desc. Computes R:R, risk $, reward $ per plan. Opens `PlanSheet` via parent callback. |
| `daily` | `DailyViewScreen.jsx` | Groups `logical_trades` by day. Each day block has a trade table with expandable raw-execution sub-table. Supports inline resolve for unmatched/ambiguous trades. |
| `sj` | `JournalScreen.jsx` | Filterable view of `logical_trades WHERE status='closed'` with R-multiple column (requires a matched `planned_trade`). Open-position activity belongs in Daily View; Journal is the closed-trade review surface only. |
| `perf` | `PerformanceScreen.jsx` | Period-filtered performance analytics: KPI cards, Recharts cumulative P&L line chart, by-symbol sortable table, by-direction bars, by-asset-class bars. All P&L is converted to base currency via `fx_rate_to_base`. |
| `ibkr` | `IBKRScreen.jsx` | Two states: disconnected (credential entry form + test button) and connected (masked creds, last sync timestamp, sync-now button, auto-sync toggle, rebuild button). Save/remove route through `/api/ibkr-credentials`; sync POSTs to `/api/sync` and renders the summary response (new-fills count + preview list). No client-side DB writes during sync. |
| `settings` | `SettingsScreen.jsx` | Reads `base_currency` and `account_id` from `user_ibkr_credentials`. All other settings rows are "Coming soon". |

### Components

| File | Responsibility |
|---|---|
| `AuthScreen.jsx` | Login, signup, password-reset forms. Uses `supabase.auth` directly. Three modes: `login`, `signup`, `reset`. |
| `Header.jsx` | Sticky top bar with logo, desktop nav tabs (Home/Plans/Daily View/Journal/Performance), hamburger button. Note: IBKR and Settings tabs are accessible only via the Sidebar or direct tab ID — they are not in the desktop nav. |
| `MobileNav.jsx` | Fixed bottom bar on mobile (`md:hidden`). Five tabs: Home, Plans, Daily, Journal, Perf. IBKR and Settings are not in the mobile nav. |
| `Sidebar.jsx` | Slide-right drawer (320 px). Shows user avatar, name, email, IBKR connection status, account ID. Links to IBKR screen and Settings screen. Contains the sign-out button. |
| `PlanSheet.jsx` | Slide-up modal form for creating a `planned_trade`. Computes live position size / risk / reward / R:R. Inserts to Supabase. Calls `onSaved` to trigger `planRefreshKey` in parent. |
| `ReviewSheet.jsx` | Slide-up step-through wizard for `needs_review` logical trades (2+ candidate plans). For each trade it shows candidate plans (matching symbol + direction + asset_category) and lets the user pick one or mark as off-plan. Updates `logical_trades.matching_status`, `planned_trade_id`, and sets `user_reviewed=true`. |

### Lib modules

| File | Responsibility |
|---|---|
| `supabaseClient.js` | Creates and exports the Supabase client singleton. Reads `import.meta.env.VITE_SUPABASE_URL` and `import.meta.env.VITE_SUPABASE_ANON_KEY` (Vite-prefixed env vars; the historic `REACT_APP_` prefix was removed when the build moved off CRA). |
| `logicalTradeBuilder.js` | Pure function. Takes raw `trades[]` and `userId`, returns `logical_trades[]` ready for Supabase insert. Groups executions by `ib_order_id` (or `ib_order_id + conid` for options), classifies open/close/C;O reversals, and applies FIFO cascade matching. |
| `applyPlanMatching` (in `api/_lib/rebuildForUser.js`) | Mutates `logicalTrades[]` in place with `matching_status` based on candidate plan count. Skips rows where `user_reviewed=true`. One match → `matched`, zero → `off_plan`, two or more → `needs_review`. Computes `adherence_score` for closed matched LTs via `api/_lib/adherenceScore.js`. Plan matching is server-only — the standalone `src/lib/planMatcher.js` was removed long ago. **No retroactive planning:** the matcher requires `plan.created_at <= trade.opened_at`, so a plan written after the trade is never a candidate. Consequence: `off_plan` rows split into two flavours — auto-tagged (`user_reviewed=false`, terminal, no UI escape) vs user-dismissed in review (`user_reviewed=true`, recoverable, candidate plans still exist). |

---

## Integration boundaries

### Browser ↔ Supabase (direct SDK calls)

Most read-paths (and a small number of writes — daily notes, the
auto-sync toggle, Stripe-status polling) call Supabase directly using
the `supabase` client exported from `src/lib/supabaseClient.js`. Calls
are authenticated via the session JWT managed by the Supabase Auth
SDK and gated by RLS + column grants.

Trading-data writes (`trades`, `open_positions`, `logical_trades`,
`user_ibkr_credentials` raw secrets) do NOT go through the browser
client. They flow through the server endpoints below.

### Browser ↔ `/api/sync`

`POST /api/sync` from `IBKRScreen.handleSync()` with
`Authorization: Bearer <Supabase-JWT>` and an empty body. The endpoint
authenticates, gates on active subscription, fetches IBKR Flex XML,
parses, persists `trades` + `open_positions`, updates credentials,
runs `rebuildForUser`, and returns a summary:

```json
{
  "success": true,
  "mode": "sync",
  "tradeCount": 49,
  "openPositionCount": 14,
  "logicalCount": 16,
  "rebuildWarnings": [],
  "newTradeCount": 3,
  "newTradesPreview": [ { "symbol": "...", "buySell": "BUY", ... } ]
}
```

The browser does not receive raw trades; it just renders the
summary and bumps `DataVersionContext` so other screens silently
refetch. Test mode (`{ token, queryId }` in body) verifies user-typed
credentials without persisting.

See `docs/backend.md` for the full flow.

### Browser ↔ `/api/ibkr-credentials`

`POST { token, queryId }` to upsert; `DELETE` to remove. Same
JWT auth. Server validates + masks + writes via `service_role`. The
browser cannot insert / update / delete `user_ibkr_credentials`
directly; `auto_sync_enabled` is the lone exception (column-level
UPDATE grant, used by the toggle).

### `/api/sync` ↔ IBKR Flex Web Service

Two HTTPS GET calls to `gdcdyn.interactivebrokers.com`:

1. `FlexStatementService.SendRequest?t=<token>&q=<queryId>&v=3` — initiates the report, returns a `ReferenceCode`
2. `FlexStatementService.GetStatement?q=<refCode>&t=<token>&v=3` — polls for the completed XML (up to 10 retries, 3 seconds apart)

---

## Navigation pattern

CT3000 uses **React Router 7** with a keep-alive layer in `AppShell`:
every visited screen stays mounted after first visit and tab switches
toggle CSS `display` rather than unmounting. First visit pays the
fetch cost (one spinner); subsequent visits are instant with preserved
state.

- URL changes per route (`/`, `/plans`, `/daily`, `/journal`,
  `/performance`, `/ibkr`, `/settings`, `/review`).
- Public routes that bypass the auth gate: `/terms`, `/privacy`,
  `/reset-password`.
- Deep-linking works: `/daily` opens Daily View directly.
- Cross-screen mutations bump a `DataVersionContext` counter; watching
  screens silently refetch without flashing a spinner.

Navigation entry points:
- Desktop: `Header` nav buttons (5 tabs visible)
- Mobile: `MobileNav` bottom bar (5 tabs visible)
- Global access: `Sidebar` links to `/ibkr` and `/settings`
- Programmatic: `useNavigate()` for cross-screen jumps (e.g. HomeScreen
  → `/daily`, plan rows → `/plans` with `state.openPlanId`)

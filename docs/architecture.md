# Architecture

## System overview

CT3000 is a three-tier web application:

1. **React SPA** — all UI, routing, and client-side data logic
2. **Vercel Serverless Function** (`/api/sync.js`) — a thin proxy between the browser and the IBKR Flex Web Service
3. **Supabase** — PostgreSQL database and email/password Auth

There is no traditional backend server. The SPA talks directly to Supabase using the JavaScript SDK, and calls the one serverless function for the IBKR integration.

---

## Data flow diagram

```
┌──────────────────────────────────────────────────────────────────┐
│                        Browser (React SPA)                       │
│                                                                  │
│  AuthScreen ──── supabase.auth.signIn/signUp/resetPassword ──┐  │
│                                                               │  │
│  IBKRScreen ─── fetch('/api/sync?token=...&queryId=...') ─┐  │  │
│                                                            │  │  │
│  All screens ──── supabase.from('table').select()/         │  │  │
│                   insert()/upsert()/update()/delete()      │  │  │
└────────────────────────────────────────────────────────────┼──┼──┘
                                                             │  │
              ┌──────────────────────────────────────────────┘  │
              ▼                                                  │
┌─────────────────────────────┐          ┌─────────────────────────┐
│  /api/sync.js               │          │  Supabase               │
│  Vercel Serverless (Node)   │          │  (PostgreSQL + Auth)    │
│                             │          │                         │
│  1. SendRequest → IBKR      │          │  Tables:                │
│     FlexStatementService    │          │   trades                │
│  2. Poll GetStatement       │          │   logical_trades        │
│     (up to 10 retries)      │          │   planned_trades        │
│  3. Regex-parse XML into    │          │   open_positions        │
│     { trades[], open        │          │   user_ibkr_credentials │
│       Positions[],          │          │                         │
│       baseCurrency }        │          │  Auth:                  │
│  4. Return JSON to browser  │          │   users (managed)       │
└─────────────────┬───────────┘          └──────────┬──────────────┘
                  │                                  │
                  ▼                                  │
   IBKR Flex Web Service                            │
   (gdcdyn.interactivebrokers.com)                  │
                                                    │
                ┌───────────────────────────────────┘
                │  After /api/sync returns JSON, the browser:
                │
                ▼
  5. Upsert trades → Supabase `trades`
  6. Delete + reinsert → Supabase `open_positions`
  7. Update `user_ibkr_credentials` (last_sync_at, base_currency, account_id)
  8. Fetch all trades → run logicalTradeBuilder (FIFO) → delete + insert `logical_trades`
  9. Fetch logical_trades + planned_trades → run planMatcher → update `logical_trades`
```

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
| `applyPlanMatching` (in `api/rebuild.js`) | Mutates `logicalTrades[]` in place with `matching_status` based on candidate plan count. Skips rows where `user_reviewed=true`. One match → `matched`, zero → `off_plan`, two or more → `needs_review`. (The standalone `src/lib/planMatcher.js` was removed with the 3-state rename — matching is now only done server-side.) |

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

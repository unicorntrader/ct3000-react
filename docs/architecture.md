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
| `src/index.js` | Mounts the React root into `#root` |
| `src/App.jsx` | Checks Supabase session; renders `AuthScreen` or `AppShell` |
| `src/App.jsx / AppShell` | Owns active tab state, sidebar/sheet visibility, `planRefreshKey`. Renders `Header`, `Sidebar`, `PlanSheet`, `ReviewSheet`, `MobileNav`, and the active screen. |

### Screens (tab-routed via `activeTab` string state)

| Tab ID | Screen file | What it does |
|---|---|---|
| `home` | `HomeScreen.jsx` | Shows 4 stat cards (today's P&L, open positions, active plans, 30d win rate), open positions list (sortable by size or date), active plans cards. Shows amber review banner when `unmatched`/`ambiguous` logical trades exist. |
| `plans` | `PlansScreen.jsx` | Lists all `planned_trades` ordered by `created_at` desc. Computes R:R, risk $, reward $ per plan. Opens `PlanSheet` via parent callback. |
| `daily` | `DailyViewScreen.jsx` | Groups `logical_trades` by day. Each day block has a trade table with expandable raw-execution sub-table. Supports inline resolve for unmatched/ambiguous trades. |
| `sj` | `JournalScreen.jsx` | Filterable view of all `logical_trades` with R-multiple column (requires a matched `planned_trade`). Shows closed-trade stats. |
| `perf` | `PerformanceScreen.jsx` | Period-filtered performance analytics: KPI cards, Recharts cumulative P&L line chart, by-symbol sortable table, by-direction bars, by-asset-class bars. All P&L is converted to base currency via `fx_rate_to_base`. |
| `ibkr` | `IBKRScreen.jsx` | Two states: disconnected (credential entry form + test button) and connected (masked creds, last sync timestamp, sync-now button). Orchestrates the full 9-step sync pipeline. |
| `settings` | `SettingsScreen.jsx` | Reads `base_currency` and `account_id` from `user_ibkr_credentials`. All other settings rows are "Coming soon". |

### Components

| File | Responsibility |
|---|---|
| `AuthScreen.jsx` | Login, signup, password-reset forms. Uses `supabase.auth` directly. Three modes: `login`, `signup`, `reset`. |
| `Header.jsx` | Sticky top bar with logo, desktop nav tabs (Home/Plans/Daily View/Journal/Performance), hamburger button. Note: IBKR and Settings tabs are accessible only via the Sidebar or direct tab ID — they are not in the desktop nav. |
| `MobileNav.jsx` | Fixed bottom bar on mobile (`md:hidden`). Five tabs: Home, Plans, Daily, Journal, Perf. IBKR and Settings are not in the mobile nav. |
| `Sidebar.jsx` | Slide-right drawer (320 px). Shows user avatar, name, email, IBKR connection status, account ID. Links to IBKR screen and Settings screen. Contains the sign-out button. |
| `PlanSheet.jsx` | Slide-up modal form for creating a `planned_trade`. Computes live position size / risk / reward / R:R. Inserts to Supabase. Calls `onSaved` to trigger `planRefreshKey` in parent. |
| `ReviewSheet.jsx` | Slide-up step-through wizard for `unmatched`/`ambiguous` logical trades. For each trade it shows candidate plans (matching symbol + direction + asset_category) and lets the user pick one or mark as unplanned. Updates `logical_trades.matching_status` and `planned_trade_id`. |

### Lib modules

| File | Responsibility |
|---|---|
| `supabaseClient.js` | Creates and exports the Supabase client singleton. Reads `REACT_APP_SUPABASE_URL` and `REACT_APP_SUPABASE_ANON_KEY` (also accepts `NEXT_PUBLIC_` prefix variants for future Next.js migration). |
| `logicalTradeBuilder.js` | Pure function. Takes raw `trades[]` and `userId`, returns `logical_trades[]` ready for Supabase insert. Groups executions by `ib_order_id` (or `ib_order_id + conid` for options), classifies open/close/C;O reversals, and applies FIFO cascade matching. |
| `planMatcher.js` | Pure function. Takes `logicalTrades[]` and `plannedTrades[]`, returns update objects `{ id, matching_status, planned_trade_id }`. Skips trades already marked `manual`. One match → `matched`, zero → `unmatched`, two or more → `ambiguous`. |

---

## Integration boundaries

### Browser ↔ Supabase (direct SDK calls)

Every screen and most components call Supabase directly using the `supabase` client exported from `src/lib/supabaseClient.js`. Calls are authenticated via the session JWT managed by the Supabase Auth SDK.

### Browser ↔ `/api/sync`

Single GET request from `IBKRScreen.handleSync()` (and `handleTestSync()`):

```
GET /api/sync?token=<ibkrToken>&queryId=<queryId>
```

Returns:
```json
{
  "success": true,
  "tradeCount": 42,
  "openPositionCount": 3,
  "trades": [...],
  "openPositions": [...],
  "baseCurrency": "USD"
}
```

The IBKR token and query ID are retrieved from Supabase (`user_ibkr_credentials`) immediately before the fetch — they are never stored in browser memory or local storage between sessions.

### `/api/sync` ↔ IBKR Flex Web Service

Two HTTPS GET calls to `gdcdyn.interactivebrokers.com`:

1. `FlexStatementService.SendRequest?t=<token>&q=<queryId>&v=3` — initiates the report, returns a `ReferenceCode`
2. `FlexStatementService.GetStatement?q=<refCode>&t=<token>&v=3` — polls for the completed XML (up to 10 retries, 3 seconds apart)

---

## Navigation pattern

CT3000 uses **tab-based routing with no URL changes**. The active screen is controlled by an `activeTab` string state in `AppShell`. There is no React Router. This means:

- The URL always stays at `/`
- Browser back/forward does not navigate between tabs
- Deep-linking to a specific tab is not supported

The navigation entry points are:
- Desktop: `Header` nav buttons (5 tabs visible)
- Mobile: `MobileNav` bottom bar (5 tabs visible)
- Global access: `Sidebar` links to `ibkr` and `settings` tabs
- Programmatic: `onTabChange` callback passed to screens (e.g. HomeScreen links to `daily` and `plans`)

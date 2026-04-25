# CT3000 — Workflow Map

> **Purpose:** a plain-English map of every file, function, and user flow in the app. Written for the project owner (a trader, not a pro engineer) to internalize how the codebase actually works. If you read this end-to-end you should be able to find any piece of the app and understand what it does without having to reverse-engineer from the source.

**Status:** accurate as of April 15, 2026. Known small staleness flagged inline.

---

## Overview

CT3000 is a React-based trading journal that:

1. Syncs trades from Interactive Brokers (IBKR) via the Flex XML service
2. Lets traders plan trades in advance
3. Auto-matches executed trades to those plans
4. Scores "adherence" (how well you followed your plan)
5. Shows multi-view analytics

Built with React + Supabase + Stripe + Vercel serverless functions.

---

## 1. File-by-file reference

### Core app structure

#### `src/index.jsx`
**Purpose:** React entry point. Mounts `<App>` into `#root`, wraps it in `BrowserRouter`, initializes Sentry from `import.meta.env.VITE_SENTRY_DSN`.
**Dependencies:** `./App`, `@sentry/react`, `react-router-dom`.
**Used by:** `/index.html` at repo root, via `<script type="module" src="/src/index.jsx">` (Vite convention).
**Data touched:** None.

#### `src/index.css`
**Purpose:** Global CSS. Custom animations (`slide-up`, `slide-right`), overlay backgrounds, toggle styles. Loads Tailwind directives.
**Used by:** All components (global).

#### `src/App.jsx`
**Purpose:** Top-level shell. Handles auth session, subscription state, Stripe checkout polling, demo seeding on first login, and routing.

**Key functions:**
- `isActive(sub)` — checks if a subscription is `'active'` or in valid `'trialing'` state
- `LoadingScreen({ message })` — spinner + optional message
- `AppShell({ session, subscription, onSubscriptionRefresh })` — renders `Header`, `Sidebar`, `DemoBanner` (when applicable), global sheet (`PlanSheet`), and the `<Routes>` tree (including `/review` route for trade resolution)
- `seedDemoData(session)` — POSTs to `/api/seed-demo` on first login so new users have something to explore before connecting IBKR
- `fetchSubscription(userId)` — pulls `user_subscriptions` row
- Default `App` — wraps auth state machine and polling after Stripe checkout

**Dependencies:** `./lib/supabaseClient`, `./lib/PrivacyContext`, every screen in `./screens/`, every shell component in `./components/`.
**Used by:** `src/index.js`.
**Tables touched:** `user_subscriptions` (read, polls), `logical_trades` (checks anon demo seed state).

---

### Screens (user-facing pages)

#### `src/screens/HomeScreen.jsx`
**Purpose:** Dashboard — "how did today go / what should I do now."

**The user sees:**
- Four stat cards: Today's P&L, Open positions count, Active plans count, 30-day win rate
- Top 10 open positions (sortable by size or date)
- Active plans list
- Review banner if any trades need manual matching

**User actions:**
- Click "View all" positions → `/daily`
- Click "View all" plans → `/plans`
- Click review banner → opens `ReviewSheet`
- Sort positions by size or date

**On mount:**
- Fetches `open_positions`, `planned_trades`, `logical_trades` (closed in last 30 days), and `base_currency` from `user_ibkr_credentials`
- Derives `todayPnl` via `pnlBase(t)`, win rate %, review count

**Tables touched:** `open_positions` (read), `planned_trades` (read), `logical_trades` (read), `user_ibkr_credentials` (read base_currency).

#### `src/screens/PlansScreen.jsx`
**Purpose:** List of all planned trades. Entry point for creating/editing plans.

**User actions:**
- Click "New plan" → opens `PlanSheet` in create mode
- Click a plan card → opens `PlanSheet` in edit mode

**On mount:** Fetches `planned_trades` ordered by `created_at DESC`.
**Tables touched:** `planned_trades` (read).

#### `src/screens/DailyViewScreen.jsx`
**Purpose:** Day-by-day trade list — raw IBKR executions grouped by order, with inline resolution for trades where the exit is ambiguous.

**User actions:**
- Click a trade row → expand to see entry/exit/P&L details
- Manually enter exit price for orphan trades
- Click review banner → opens `ReviewSheet`
- Share a trade → opens `ShareModal`

**On mount:** Fetches `logical_trades`, `open_positions`, raw `trades` for the day. Builds exit-price map from closing trades via FIFO.

**Tables touched:** `logical_trades` (read, update `matching_status`), `open_positions` (read), `trades` (read), `daily_notes` (read/upsert).

#### `src/screens/JournalScreen.jsx` (Smart Journal)
**Purpose:** Full trade list with powerful filtering. The main "review your trades" screen.

**User sees:**
- Summary stats: closed trades count, win rate, journalled count
- Smart filter bar: Symbol (autocomplete), Direction, Asset class, Date range
- Filter tabs: All / Open / Wins / Losses / Matched / Unmatched / Ambiguous / Journalled / Not journalled
- Table with columns: Date · Symbol · Direction · P&L · R · **Adh** · Outcome · Plan · Journal · [share]

**User actions:**
- Apply smart filters (combine with AND logic)
- Click tab filters
- Click a row → opens `TradeJournalDrawer`
- Click share icon → opens `ShareModal`
- Accept `location.state` filters from `PerformanceScreen` navigation (pre-filters by symbol + period)

**On mount:** Fetches `logical_trades`, `planned_trades`, and `base_currency`. Plumbs plans into a `plansMap` keyed by `planned_trade_id`.

**Tables touched:** `logical_trades` (read), `planned_trades` (read), `user_ibkr_credentials` (read base_currency). Writes via `TradeJournalDrawer` child.

#### `src/screens/PerformanceScreen.jsx`
**Purpose:** Analytics dashboard — KPIs, cumulative P&L curve, and "by slice" breakdowns.

**User sees:**
- Period picker: 1D / 1W / 1M / 3M / All + custom date range
- Four KPI cards: Net P&L, Win rate, Avg W/L, Expectancy
- Cumulative P&L line chart
- By-symbol table (top 20, sortable, clickable rows → Journal)
- By-direction bar rows
- By-asset-class bar rows

**User actions:**
- Change period / date range
- Sort by-symbol table
- Click a symbol → navigates to `/journal` with symbol + period as `location.state`

**On mount:** Fetches `logical_trades` (all closed) + `base_currency`.
**Tables touched:** `logical_trades` (read), `user_ibkr_credentials` (read base_currency).

#### `src/screens/IBKRScreen.jsx`
**Purpose:** Connect IBKR, store Flex Query token + query ID, trigger sync / rebuild.

**User actions:**
- Enter Flex token and query ID → save
- "Test first" to validate credentials
- "Sync now" → calls `/api/sync.js`
- "Rebuild" → calls `/api/rebuild.js`
- Disconnect / update credentials

**Tables touched:** `user_ibkr_credentials` (read, upsert, delete), `trades` (delete before sync), `open_positions` (delete + insert fresh), `logical_trades` (rebuilt via API).

#### `src/screens/SettingsScreen.jsx`
**Purpose:** Account settings. Currently shows base currency + IBKR account ID + placeholder for future settings.
**Tables touched:** `user_ibkr_credentials` (read).

#### `src/screens/PaywallScreen.jsx`
**Purpose:** Shown to users without an active subscription. Kicks off Stripe checkout.
**Tables touched:** Triggers `/api/create-checkout-session` which writes to `user_subscriptions`.

---

### Components (shared UI widgets)

#### `src/components/AuthScreen.jsx`
**Purpose:** Login / signup / password reset / invite redemption entrypoint.
**Modes:** `landing`, `signup`, `login`, `reset`, `invite` (if `?invite=<token>` in URL).
**Tables touched:** `auth.users` (signUp, signIn). Redirects to Stripe checkout on signup.

#### `src/components/PlanSheet.jsx`
**Purpose:** Bottom sheet to create or edit a planned trade. Lives globally in `AppShell`.

**Form fields:** symbol, direction, asset category, strategy, entry, target, stop, quantity, thesis.
**Live calculations:** position size, risk, reward, R:R.
**Shows:** historical trades for the symbol as reference.
**Keyboard:** Esc closes.

**Tables touched:** `planned_trades` (insert, update, delete), `user_ibkr_credentials` (read base_currency), `logical_trades` (read historical).

#### `src/components/ReviewSheet.jsx`
**Purpose:** Multi-step wizard to resolve `needs_review` trades (those with 2+ candidate plans that the system couldn't auto-pick).

**Flow:** For each `needs_review` trade, show candidate plans (matching symbol + direction + asset class) → user picks one or says "no plan" → update `matching_status` to `matched` / `off_plan` with `user_reviewed=true` so the decision survives subsequent rebuilds.

**Keyboard shortcuts:** Enter = match, N = no plan, Esc = close.
**Tables touched:** `logical_trades` (read + update), `planned_trades` (read), `user_ibkr_credentials` (read base_currency).

#### `src/components/TradeJournalDrawer.jsx`
**Purpose:** Bottom drawer shown when clicking a trade row in `JournalScreen`. The "review one trade" surface.

**Shows:**
- Trade header (symbol, direction, status badge)
- Stat cards: Entry · Exit · P&L · R-multiple
- Adherence pill (if matched closed trade)
- Plan vs actual comparison table (if matched)
- Notes textarea

**Keyboard:** Esc closes. Enter saves (but *only* when focus is outside INPUT/TEXTAREA/SELECT so typing in the notes still works normally).

**Tables touched:** `logical_trades` (update `review_notes` and `adherence_score`), `planned_trades` (read via prop).

#### `src/components/ShareModal.jsx`
**Purpose:** Pre-fills an X/Twitter "share trade" card with symbol, direction, entry, exit, P&L, R, and a `#CT3000` hashtag.
**Keyboard:** Esc closes. Enter fires "Share on X".
**Tables touched:** None (read-only, opens external URL).

#### `src/components/Header.jsx`
**Purpose:** Top nav bar (desktop). Logo + NavLinks + privacy toggle.
**Tables touched:** None.

#### `src/components/Sidebar.jsx`
**Purpose:** Right-side slide-out menu showing user profile, IBKR connection state, nav links.
**Tables touched:** `user_ibkr_credentials` (read masked token + account_id).

#### `src/components/MobileNav.jsx`
**Purpose:** Fixed bottom nav bar (mobile). Same NavLinks as Header + privacy toggle.

#### `src/components/DemoBanner.jsx`
**Purpose:** Blue banner shown to signed-up users who still have demo data (haven't connected IBKR yet). Nudges them to /ibkr. Auto-disappears when api/sync.js flips `ibkr_connected=true` on first successful sync.

#### `src/components/PrivacyValue.jsx`
**Purpose:** Small wrapper component that either renders the passed value or a `•••` mask, based on the `PrivacyContext`. Used everywhere P&L and quantities are shown.

---

### Helper libraries (`src/lib/`)

#### `src/lib/supabaseClient.js`
**Purpose:** Single Supabase client instance, configured from `import.meta.env.VITE_SUPABASE_URL` + `import.meta.env.VITE_SUPABASE_ANON_KEY` (Vite-prefixed env vars).
**Used by:** Every file that touches the DB.

#### `src/lib/PrivacyContext.js`
**Purpose:** Global React context with a boolean `isPrivate` and a `togglePrivacy()` function. Used by `PrivacyValue`, `Header`, `MobileNav`, `ShareModal`.

#### `src/lib/formatters.js`
**Purpose:** The single source of truth for formatting and FX conversion.

| Export | What it does |
|---|---|
| `pnlBase(t)` | Converts trade P&L to base currency: `total_realized_pnl × fx_rate_to_base`. **Always use this instead of `trade.total_realized_pnl` for display or aggregation.** |
| `currencySymbol(c)` | Maps currency code → symbol (`USD`→`$`, `JPY`→`¥`, `EUR`→`€`, `GBP`→`£`). |
| `fmtPrice(n, currency)` | Price display, e.g. `$1,234.56`. Null → `—`. |
| `fmtPnl(n, currency, decimals?)` | Signed P&L, e.g. `+$1,234.56`. Null → `—`. |
| `fmtShort(n, currency)` | Compact form for chart axes: `+$1.2k`. |
| `fmtDate(iso)` | Short date, no year: `Apr 11`. |
| `fmtDateLong(iso)` | Long date with year: `Apr 11, 2026`. |

_Note: the `src/lib/logicalTradeBuilder.js`, `src/lib/planMatcher.js`,
and `src/lib/adherenceScore.js` modules previously documented here
have been removed. FIFO matching, plan matching, and adherence scoring
are now exclusively server-side under `api/_lib/`. See `api/_lib/`
section below._

---

### API routes (`api/`)

#### `api/sync.js`
**Purpose:** Server-authoritative IBKR sync. Authenticates JWT, gates on
active subscription, fetches Flex XML, parses, persists trades +
positions, updates credentials, runs rebuild, returns a summary.

**Flow:**
1. Verify Bearer Supabase JWT → resolve `user.id`
2. `requireActiveSubscription(user.id, supabaseAdmin)` — 402 if not active/trialing/comped
3. (test mode if `body.token + body.queryId` present) — verify creds against IBKR, return counts, no DB writes
4. (normal sync) Delegate to `performUserSync(user.id, supabaseAdmin)`:
   - Read IBKR token + queryId from `user_ibkr_credentials`
   - `SendRequest` → `GetStatement` polling
   - Parse XML; reject if Flex period > 35 days
   - Diff incoming `ib_exec_id`s against existing rows (for the new-fills count)
   - Upsert raw `trades` by `(user_id, ib_exec_id)`
   - Delete + re-insert `open_positions` (snapshot replace)
   - Clear demo rows on `logical_trades`, `open_positions`, `planned_trades`, `playbooks`
   - Set `user_subscriptions.ibkr_connected = true`
   - Update `user_ibkr_credentials.last_sync_at` + `account_id` + `base_currency` + clear failure state
   - Call `rebuildForUser(userId, supabaseAdmin)` to regenerate `logical_trades`
5. Return summary `{ tradeCount, openPositionCount, logicalCount, rebuildWarnings, newTradeCount, newTradesPreview }`

**Uses:** `supabaseAdmin` (service-role), bypasses RLS.
**Tables written:** `trades`, `open_positions`, `user_ibkr_credentials`,
`user_subscriptions.ibkr_connected`, `logical_trades` (via rebuild).
The browser does NOT write any of these during sync.

#### `api/rebuild.js`
**Purpose:** Standalone "rebuild logical_trades from existing raw trades"
endpoint. Same JWT auth + subscription gate as sync. Calls
`rebuildForUser(userId, supabaseAdmin)`.

`rebuildForUser` (in `api/_lib/`):
1. Fetch all `trades` for user
2. Read existing `logical_trades` to preserve user-reviewed decisions
3. Call `buildLogicalTrades(rawTrades, userId)` (FIFO)
4. Fetch `planned_trades`; apply plan matching + compute adherence
5. Backfill `planned_trades.currency` where missing
6. Delete + insert `logical_trades`
7. Return `{ count, warnings }`

`/api/sync` calls `rebuildForUser` directly (in-process), so this
endpoint is mainly for "rebuild without a fresh IBKR pull".

**Tables written:** `logical_trades`, `planned_trades.currency`.
**Tables read:** `trades`, `planned_trades`, existing `logical_trades`.

#### `api/ibkr-credentials.js`
**Purpose:** Server-only path for saving / removing IBKR credentials.
Closes the last browser-write surface on `user_ibkr_credentials`.

**POST** `{ token, queryId }`: validate, mask, upsert via `service_role`. Returns `{ success, tokenMasked, queryIdMasked }`.

**DELETE**: remove the user's credentials row.

The browser cannot insert / update / delete this table directly
post-2026-04-25 (DB grants revoked, except column-level UPDATE on
`auto_sync_enabled` for the toggle).

#### `api/seed-demo.js`
**Purpose:** Seed demo data for newly signed-up users on first sign-in so they have something to explore before connecting IBKR.

**Safeguards:**
- Skips if already seeded (idempotent). Still updates `user_subscriptions.demo_seeded=true` on the short-circuit path so the DemoBanner gate works for users whose is_demo rows pre-date the flag.

**What it inserts:**
- 5 demo plans (NVDA, AAPL, TSLA, SPY, MSFT)
- ~20 demo logical trades (mix of wins, losses, matched, unmatched, open)
- 5 demo open positions
- 2 demo playbooks

**Called by:** `App.seedDemoData(session)` — fires on first login when `!demo_seeded && !ibkr_connected`.
**Tables written:** `planned_trades`, `logical_trades`, `open_positions`, `playbooks`, `user_subscriptions` (sets `demo_seeded=true`).

#### `api/create-checkout-session.js`
**Purpose:** Create a Stripe Checkout Session tied to the user's Supabase ID.

**Flow:**
1. Verify Bearer token
2. Find or create Stripe customer (linked via metadata `user_id`)
3. Upsert pending `user_subscriptions` row
4. Create Stripe Checkout Session with `STRIPE_PRICE_ID`, success URL with `?checkout=success`
5. Return session URL

**Called by:** `AuthScreen` (signup), `PaywallScreen`.
**Tables written:** `user_subscriptions`.

#### `api/stripe-webhook.js`
**Purpose:** Receive Stripe webhook events and update `user_subscriptions` accordingly.

**Events handled:**
- `checkout.session.completed` → mark subscription active/trialing
- `customer.subscription.updated` → update status, period end
- `customer.subscription.deleted` → mark canceled
- `invoice.payment_succeeded` → refresh period end

**Uses:** `supabaseAdmin` (bypasses RLS — this is the only place the `user_subscriptions` table gets written from the server).
**Called by:** Stripe (configured as webhook endpoint).

#### `api/redeem-invite.js`
**Purpose:** Validate an invite token, create an auth user, grant a comped subscription.

**Flow:**
1. Validate token from `invited_users` table
2. Check email matches
3. Create Supabase auth user
4. Insert `user_subscriptions` row with `is_comped=true`, `status='active'`
5. Mark invite as redeemed

**Current status:** Functional but **not wired to any UI path**. Unclear if it's a planned feature or abandoned. Logged as a question in the audit.

#### `api/lib/supabaseAdmin.js`
**Purpose:** Server-side Supabase client using `SUPABASE_SERVICE_ROLE_KEY`. Bypasses RLS. Used by every `api/*.js` file for privileged writes.

---

### Database migrations (`supabase/migrations/`)

| File | What it did |
|---|---|
| `20260411_add_currency_to_logical_trades.sql` | Added `currency text` column to `logical_trades`. Currency code display support. |
| `20260411_create_user_subscriptions.sql` | Created the `user_subscriptions` table with Stripe IDs, status, trial dates, demo flags. |
| `20260413_add_rls_and_daily_notes.sql` | Enabled RLS + policies on `trades`, `logical_trades`, `planned_trades`, `open_positions`, `user_ibkr_credentials`, and created `daily_notes` table with RLS. |
| `20260414_cleanup_demo_planned_trades.sql` | One-time cleanup: removed stale demo rows from `planned_trades` caused by a bug where WelcomeModal called seed-demo for real users. |
| `20260414_cleanup_all_demo_rows.sql` | Broader cleanup across all 4 tables touched by seed-demo. |
| `20260414_fix_missing_rls.sql` | Enabled RLS on `securities`, `anonymous_sessions`, `ghost_webhook_events`, `user_subscriptions`, `invited_users` — tables the earlier RLS migration had missed. Flagged by Supabase linter April 14. |

> **Not in migrations:** the tables themselves (`trades`, `logical_trades`, `planned_trades`, `open_positions`, `user_ibkr_credentials`) were created via the Supabase dashboard, not via a checked-in migration. **There is no schema source of truth in the repo.** This is the root cause of the recurring "column doesn't exist" bugs we've hit.

---

## 2. End-to-end user flows

### Flow A: First-time real user signup → connected account

1. **AuthScreen** — user clicks "Sign up"
2. `handleSignup()` → `supabase.auth.signUp()` → creates auth user
3. `createCheckoutSession()` → POST `/api/create-checkout-session`
4. Response → redirect to Stripe Checkout
5. User pays → Stripe redirects back with `?checkout=success`
6. `App` detects the query param → starts polling `user_subscriptions` every 2 seconds
7. Stripe webhook fires → `/api/stripe-webhook.js` → writes the active subscription row
8. App poll detects the row → `isActive(sub) === true` → peeks `user_subscriptions`
9. Sees `!demo_seeded && !ibkr_connected` → POST `/api/seed-demo` → populates demo data
10. `AppShell` renders with `DemoBanner` across the top ("you're exploring with demo data — connect IBKR")
11. User clicks banner "Connect IBKR" → navigates to `/ibkr`
12. **IBKRScreen** — user pastes Flex token + query ID, clicks "Test first" then "Save"
13. Credentials upserted to `user_ibkr_credentials`
14. User clicks "Sync now" → POST `/api/sync.js`
15. Sync fetches XML → parses → deletes is_demo rows → writes real `trades` + `open_positions` → sets `ibkr_connected=true` → calls rebuild
16. Rebuild runs `buildLogicalTrades` + plan matcher → upserts `logical_trades`
17. DemoBanner disappears (condition `!ibkr_connected` now false). User sees live data.

### Flow B: Daily sync

1. User clicks "Sync now" on `IBKRScreen`
2. POST `/api/sync.js` (with Bearer JWT)
3. Fetch Flex XML from IBKR
4. Parse trades + open positions + base currency
5. Upsert raw `trades`, delete + re-insert `open_positions`, update `user_ibkr_credentials`
6. Internal call to `/api/rebuild.js`
7. `buildLogicalTrades()` → `planMatcher()` → upsert `logical_trades`
8. Return counts → UI shows success banner
9. Review queue count appears on HomeScreen if any unmatched/ambiguous trades surfaced

### Flow C: Plan → execute → auto-match → review

1. **PlansScreen** → click "New plan" → `PlanSheet` opens
2. Fill form → "Save plan" → insert into `planned_trades`
3. Later, user executes the trade on IBKR
4. User runs sync (Flow B)
5. Raw trades → `trades` table
6. Rebuild → logical trade created with matching `symbol + direction + asset_category`
7. `applyPlanMatching` (in `api/_lib/rebuildForUser.js`) finds the plan → `matching_status='matched'`, `planned_trade_id` set, and `adherence_score` computed via `computeAdherenceScore(plan, lt)` for closed trades
8. **JournalScreen** → click the trade row → `TradeInlineDetail` expands inline
9. Detail shows plan vs actual + the precomputed adherence score
10. User types notes, hits Save → writes `review_notes`

### Flow E: Manual review (unmatched / ambiguous)

1. HomeScreen review banner: "3 trades need review"
2. Click banner → `ReviewSheet` opens
3. Fetches `needs_review` `logical_trades` + `planned_trades`
4. For each trade, filters candidate plans by symbol + direction + asset
5. User picks a match (or "No plan") → writes `matching_status='matched'|'off_plan'` + `planned_trade_id` + `user_reviewed=true`
6. Advance step → next trade → ... → done
7. Banner disappears

### Flow F: Share on X

1. JournalScreen row → click share icon → `ShareModal` opens
2. Pre-fills text with symbol, direction, entry, exit, P&L, R, `#CT3000`
3. Click "Share on X" (or press Enter) → opens Twitter intent URL in new tab
4. Tweet pre-populated; user clicks Post.

---

## 3. Data flow diagram

```
┌──────────────────────────────────────────────────────────────┐
│             Interactive Brokers                              │
│           (Flex Query XML Service)                           │
└─────────────────────────┬────────────────────────────────────┘
                          │
                          │ XML payload (trades + positions + base_currency)
                          ▼
            ┌──────────────────────────┐
            │       /api/sync.js       │
            │ (parse XML, upsert DB)   │
            └───┬──────────┬─────────┬─┘
                │          │         │
                ▼          ▼         ▼
        ┌────────────┐ ┌──────────┐ ┌─────────────────┐
        │   trades   │ │  open_   │ │ user_ibkr_      │
        │   (raw)    │ │ positions│ │ credentials     │
        └──────┬─────┘ └──────────┘ │ (base_currency, │
               │                    │  last_sync_at)  │
               │                    └─────────────────┘
               ▼
     ┌──────────────────────────────────┐
     │  api/_lib/rebuildForUser.js      │
     │  (called inline by /api/sync     │
     │   AND directly by /api/rebuild)  │
     └──────────┬───────────────────────┘
                │
                │ buildLogicalTrades()
                │ ─ group by order
                │ ─ FIFO match opens ↔ closes
                │ ─ compute avg entry, exit, realized pnl, fx rate
                │
                │ applyPlanMatching()
                │ ─ match symbol + direction + asset_category
                │ ─ set matching_status, planned_trade_id
                │ ─ computeAdherenceScore(plan, lt) for closed matched LTs
                │
                │ preserve user_reviewed=true rows across rebuilds
                │   via opening_ib_order_id + conid key
                │
                ▼
     ┌──────────────────────────┐
     │      logical_trades      │   ← planned_trades (user-created)
     │                          │      linked via planned_trade_id
     │   ─ symbol, direction    │
     │   ─ status, opened/closed│
     │   ─ total_realized_pnl   │
     │   ─ fx_rate_to_base      │
     │   ─ matching_status      │
     │   ─ planned_trade_id     │
     │   ─ adherence_score      │  ← set during rebuild for matched closed LTs
     │   ─ review_notes         │  ← user-entered via TradeInlineDetail
     └────────┬─────────────────┘
              │
              ├─────────────────┬──────────────┬────────────┐
              ▼                 ▼              ▼            ▼
        ┌──────────┐  ┌────────────────┐  ┌────────┐  ┌──────────┐
        │ Journal  │  │  Performance   │  │ Home   │  │ Daily    │
        │ (closed) │  │  (KPIs/chart)  │  │ (stats)│  │ View     │
        └────┬─────┘  └────────────────┘  └────────┘  └──────────┘
             │
             ▼
     ┌──────────────────┐
     │ TradeInlineDetail│
     │ ─ stats          │
     │ ─ plan vs actual │
     │ ─ adherence pill │
     │ ─ notes editor   │
     │ ─ save writes:   │
     │   review_notes   │
     └──────────────────┘
```

---

## 4. Who reads / writes each table

| Table | Read by | Written by |
|---|---|---|
| `auth.users` | App, all screens (via `session`) | `AuthScreen`, `api/redeem-invite` |
| `user_subscriptions` | App (polling), `PaywallScreen` | `api/stripe-webhook`, `api/create-checkout-session`, `api/redeem-invite`, `WelcomeModal` (flag) |
| `user_ibkr_credentials` | `IBKRScreen`, `Sidebar`, `SettingsScreen`, `HomeScreen`, `JournalScreen`, `PerformanceScreen`, `DailyViewScreen`, `ReviewSheet`, `PlanSheet` (masked + metadata cols only — raw `ibkr_token` / `query_id_30d` are revoked from browser SELECT) | `api/ibkr-credentials.js` (POST upsert, DELETE), `api/sync.js` (last_sync_at + account_id + base_currency), `api/cron-sync.js` (failure state). Browser direct write limited to `auto_sync_enabled` toggle. |
| `trades` (raw) | `api/_lib/rebuildForUser.js`, `DailyViewScreen` | `api/sync.js` (upsert via `performUserSync`) |
| `logical_trades` | `HomeScreen`, `DailyViewScreen`, `JournalScreen`, `PerformanceScreen`, `TradeInlineDetail`, `ReviewScreen`, `PlanSheet` (history), server rebuild | server rebuild (`rebuildForUser` — drops + re-inserts), `TradeInlineDetail` (review_notes), `ReviewScreen` (matching_status + planned_trade_id + user_reviewed), `DailyViewScreen` (resolve action) |
| `planned_trades` | `PlansScreen`, `PlanSheet`, `JournalScreen`, `ReviewSheet`, `api/rebuild.js`, `api/seed-demo.js` | `PlanSheet` (CRUD), `api/seed-demo.js` |
| `open_positions` | `HomeScreen`, `DailyViewScreen` | `api/sync.js` (delete + re-insert), `api/seed-demo.js` |
| `daily_notes` | `DailyViewScreen` | `DailyViewScreen` (upsert) |
| `invited_users` | `api/redeem-invite.js` | `api/redeem-invite.js` (external creation + mark redeemed) |
| `playbooks` | `JournalScreen` (Playbooks section), `PlaybookSheet` | `api/seed-demo.js`, `PlaybookSheet` (CRUD) |
| `securities` | (none in client code; reference data) | (none from our code) |
| `ghost_webhook_events` | (service_role only) | (service_role only) |

---

## 5. Key algorithms

### FIFO logical trade builder
1. Sort raw trades by `date_time`
2. Group by order key
3. For each group, determine open/close/reversal
4. For closes, match oldest open of same symbol
5. Accumulate `avg_entry_price` (weighted), `total_realized_pnl`, `fx_rate_to_base`
6. Produce one logical trade per position lifecycle

### Plan matching
```
for trade in logical_trades:
    if trade.user_reviewed: skip
    matches = [p for p in plans
               if upper(p.symbol) == upper(trade.symbol)
               and upper(p.direction) == upper(trade.direction)
               and upper(p.asset_category) == upper(trade.asset_category)]
    if len(matches) == 1: matching_status = 'matched', set planned_trade_id
    elif len(matches) == 0: matching_status = 'off_plan'
    else: matching_status = 'needs_review'
```

### Adherence scoring
See `src/lib/adherenceScore.js`. Four sub-scores (entry slippage, target capture, stop respect, quantity deviation) averaged to a 0–100 overall.

---

## 6. Auth & authorization

**Session types:**
- **Real user:** signed up via email/password or invite. Full access post-subscription. Gets populated demo data on first login until they connect IBKR.
- **Comped user:** redeemed an invite token. `is_comped=true`, `subscription_status='active'`. Same app experience as a paying user; Stripe webhook skips updates for them.

**RLS (Row Level Security):** Every table has a policy that restricts rows to `auth.uid() = user_id`. This is the security boundary, not client-side filters. All server-side code uses `supabaseAdmin` (service role) which bypasses RLS. Client code uses the anon key which is subject to RLS.

**Convention:** Every client Supabase query still explicitly includes `.eq('user_id', ...)` (belt + suspenders — RLS is the belt).

---

## 7. Privacy mode

- Global `PrivacyContext` with boolean `isPrivate`
- Toggle in `Header` / `MobileNav`
- `PrivacyValue` component renders `•••` when private, value otherwise
- Only dollar amounts and quantities are masked — prices and percentages stay visible (they're less sensitive than absolute P&L)

---

## 8. Deployment

- **Frontend:** Vercel (auto-deploy on push to `main`)
- **Serverless API:** Vercel Functions (`/api/*.js`)
- **DB + Auth:** Supabase
- **Payments:** Stripe (webhook to `/api/stripe-webhook.js`)

---

## Known inaccuracies in this doc (to fix)

- **`planned_trades.notes` column** — referenced earlier in some parts of the app and in migration-adjacent docs. It does NOT exist. The canonical column is `thesis`. All code using `notes` has been fixed (as of April 15) but this doc should never imply the column exists.
- **`user_ibkr_credentials` column names** — described from inference, not a schema file. Verify against live Supabase if you're about to write a migration.
- **`adherence_score` is sometimes described as "computed on sync"** — it's NOT. Only `TradeJournalDrawer.handleSave` writes it today. This is the biggest open architectural item.

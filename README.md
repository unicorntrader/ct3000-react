# CT3000 — Trading Journal

React + Supabase + Vercel. An IBKR-connected trading journal for retail traders who plan → execute → review. Built around three pillars:

1. **Plan** — write a trade plan (entry / target / stop / size / thesis) before entering.
2. **Execute** — IBKR Flex XML syncs executions automatically.
3. **Review** — plans get auto-matched to the resulting trades; adherence scoring shows how well you followed your own playbook.

---

## Architecture

### Data flow
```
IBKR Flex XML
      │
      ▼
  api/sync.js         ← Vercel serverless, parses XML
      │
      ▼
  trades              ← raw IBKR executions (includes fx_rate_to_base, currency)
      │
      ▼
  src/lib/logicalTradeBuilder.js   ← FIFO matching into logical trades
      │
      ▼
  logical_trades      ← realised P&L positions, matched to plans
      │
      ▼
  Screens             ← HomeScreen, JournalScreen, PerformanceScreen, DailyViewScreen
```

### Tables (Supabase)
| Table | Purpose |
|---|---|
| `trades` | Raw IBKR executions. Includes `fx_rate_to_base`, `currency`. |
| `logical_trades` | FIFO-matched positions. Includes `fx_rate_to_base`, `total_realized_pnl`, `adherence_score`, `review_notes`, `matching_status`, `planned_trade_id`. |
| `planned_trades` | User trade plans. Canonical columns: `planned_entry_price`, `planned_stop_loss`, `planned_target_price`, `planned_quantity`, `thesis`, `strategy` (NOT NULL), `asset_category`. |
| `open_positions` | Current open positions from IBKR. |
| `user_ibkr_credentials` | IBKR token, account_id, `last_sync_at`, `base_currency`. |
| `user_subscriptions` | Stripe subscription state + flags (`has_seen_welcome`, `demo_seeded`, `ibkr_connected`). |
| `weekly_reviews` *(proposed)* | Qualitative weekly review notes. Not yet built. |

### Core libraries
| File | What it does |
|---|---|
| `src/lib/formatters.js` | **Single source of truth for formatting and FX.** `pnlBase(t)`, `fmtPnl`, `fmtPrice`, `fmtDate`, `fmtShort`, `currencySymbol`. Import from here — never redefine locally. |
| `src/lib/logicalTradeBuilder.js` | FIFO matcher: raw trades → logical trades. Runs in `api/sync.js`. |
| `src/lib/planMatcher.js` | Matches logical trades to user plans by symbol + direction + asset category. |
| `src/lib/adherenceScore.js` | Computes 0–100 adherence from a (plan, trade) pair. Four sub-scores (entry / target / stop / size) averaged. |
| `src/lib/PrivacyContext.js` | Global toggle for masking dollar amounts. |

### Screens
| Screen | What it shows |
|---|---|
| `HomeScreen` | Today's P&L, open positions, active plans, 30-day win rate, review reminder. |
| `PlansScreen` | All planned trades — create / edit / delete. |
| `DailyViewScreen` | Day-by-day list of executions grouped by order. |
| `JournalScreen` (Smart Journal) | Full list of logical trades with filters (symbol / direction / asset / date range) and per-trade drawer. Shows adherence column per trade. |
| `PerformanceScreen` | KPIs, cumulative P&L curve, top 20 symbols (clickable → Journal with symbol + period pre-filled), direction/asset breakdowns. |
| `IBKRScreen` | Connect / disconnect IBKR, trigger sync. |
| `SettingsScreen` | Sign out, subscription. |
| `PaywallScreen` | Stripe checkout entrypoint. |
| `AuthScreen` | Email/password + anonymous demo. |

### Popups / drawers
| Component | Type | Esc | Enter |
|---|---|---|---|
| `TradeJournalDrawer` | Bottom drawer — trade detail, plan vs actual, adherence, notes | ✅ | — |
| `PlanSheet` | Bottom drawer — create/edit plan | ✅ | — |
| `ReviewSheet` | Bottom drawer — end-of-day review wizard | ❌ | — |
| `ShareModal` | Center modal — share card for X/Twitter | ✅ | ✅ (fires share) |
| `Sidebar` | Right drawer — mobile nav | ❌ | — |
| `WelcomeModal` | Center modal — one-time welcome | ❌ | — |

### Routing
`react-router-dom 7`. Routes declared in `src/App.jsx`. Cross-screen state passing uses `navigate(path, { state: {...} })` and `useLocation()`. Currently used for Performance → Journal symbol+period handoff.

---

## Conventions (from `CLAUDE.md` — read before coding)

- **All Supabase queries must include `.eq('user_id', ...)`** — no exceptions.
- **`select('*')` is safe; explicit column lists will 400 if a column doesn't exist.** When in doubt, use `*`.
- **Silent errors:** always check the `error` field. `PGRST116` (no rows) is expected for new users.
- **Format functions:** null fallback is always `—`, never `N/A`.
- **No dynamic `await import()`** — static imports only, to avoid webpack chunk hash issues on deploy.
- **P&L conversion:** always go through `pnlBase(t)` from `src/lib/formatters.js`. Never use `trade.total_realized_pnl` raw. Multi-currency traders break silently if you skip this.
- **Canonical column names:** `planned_entry_price`, `planned_stop_loss`, `planned_target_price`, `planned_quantity`. Old aliases (`entry_price`, `stop_price`, `target_price`, `shares`, `quantity`) will not work.
- **Direction values are uppercase:** `LONG` / `SHORT`. Use those exact strings in filters and comparisons.

---

## Audit findings (as of April 14, 2026)

Current state. ✅ = fixed, ⚠️ = open, 🔴 = critical.

### 🔴 Critical

| # | Issue | File | Status |
|---|---|---|---|
| C1 | HomeScreen `todayPnl` and W/L counts use raw `total_realized_pnl` — **wrong for multi-currency users** | `src/screens/HomeScreen.jsx` (~l.49, 54) | ⚠️ open |
| C2 | ReviewSheet trade card shows native P&L via `fmtPnl(pnl)` — no FX conversion | `src/components/ReviewSheet.jsx` (~l.22) | ⚠️ open |
| C3 | `api/seed-demo.js` is stale: inserts non-existent `notes` column, missing NOT NULL `strategy`. **Any anonymous demo user today fails to seed.** | `api/seed-demo.js` | ⚠️ open |

### ⚠️ High priority

| # | Issue | File | Status |
|---|---|---|---|
| H1 | JournalScreen was selecting non-existent `notes` column on `planned_trades`, silently 400ing → no adherence section in drawer for anyone | `src/screens/JournalScreen.jsx` | ✅ fixed `a6a19062` |
| H2 | Direction filter dropdown used `Long`/`Short` but DB stores `LONG`/`SHORT` — filter never matched | `src/screens/JournalScreen.jsx` | ✅ fixed `a0426def` |
| H3 | TradeJournalDrawer had no Escape-to-close | `src/components/TradeJournalDrawer.jsx` | ✅ fixed `a0426def` |
| H4 | Adherence score only persists when user saves notes. Should auto-compute when a trade is matched. | `src/components/TradeJournalDrawer.jsx` + builder | ⚠️ open — needs to move into `logicalTradeBuilder.js` / `planMatcher.js` |
| H5 | ReviewSheet `handleMatch` doesn't check Supabase error — silent failure advances step anyway | `src/components/ReviewSheet.jsx` (l.106–116) | ⚠️ open |
| H6 | TradeJournalDrawer `handleSave` doesn't check `.update()` error — "Saved" state shown even on failure | `src/components/TradeJournalDrawer.jsx` (l.85–98) | ⚠️ open |
| H7 | Plan query in `ReviewSheet` selects non-existent `notes` column — same root cause as H1 | `src/components/ReviewSheet.jsx` (l.78) | ⚠️ open |

### 🟡 Medium — inconsistencies

| # | Issue | Where |
|---|---|---|
| M1 | P&L conversion inconsistent across screens: HomeScreen + ReviewSheet use raw, Journal + Performance use `pnlBase()` | multiple |
| M2 | Direction case inconsistent in UI: HomeScreen lowercases (`long`/`short`), Journal renders as-is (`LONG`/`SHORT`) | `HomeScreen.jsx`, `JournalScreen.jsx` |
| M3 | `logical_trades.opened_at` / `closed_at` are `varchar(20)`, not `timestamptz`. Awkward for date math; forces string slicing. | DB schema |
| M4 | `baseCurrency` fetched independently by `DailyView`, `Performance`, `Journal` on every mount — 3 redundant queries | 3 screens — candidate for a context provider |
| M5 | No Esc handler on `Sidebar`, `ReviewSheet`, `WelcomeModal` | 3 components |
| M6 | No schema source of truth checked in. Migrations in `supabase/migrations/` only contain RLS + cleanups; `planned_trades` and `logical_trades` were created via Supabase UI and drift with the code. | `supabase/migrations/` |

### 🟢 Nits

| # | Issue | Where |
|---|---|---|
| N1 | `PerformanceScreen` recomputes `periodMap` / `dateFilter` inside `.map(row => {...})` — runs 20× per render | `PerformanceScreen.jsx` (~l.434–447) |
| N2 | `JournalScreen` reads `location.state?.symbolFilter` only into `useState` initial value. If component stays mounted across two navigations, second click from Performance won't update the filter. | `JournalScreen.jsx` (l.55) |
| N3 | `CHECKOUT_SUCCESS` captured at module load (`App.jsx` l.25) — race if two tabs open with `?checkout=success` | `App.jsx` |
| N4 | Form validation in PlanSheet is text-only (`setError()`) — no red borders on invalid fields | `PlanSheet.jsx` |

### ❓ Questions / dead code

| # | Question | Where |
|---|---|---|
| Q1 | `api/rebuild.js` — what triggers this? Not referenced anywhere in the frontend. Cron? Admin tool? | `api/rebuild.js` |
| Q2 | `api/redeem-invite.js` — in-progress feature or abandoned? Not wired to any UI. | `api/redeem-invite.js` |
| Q3 | `weekly_reviews` table — does it exist? Performance Review template (see April 14 log) suggests we need one. | Supabase |

---

## Supabase query risk inventory

Every explicit-column `.select()` call and its risk level if schema drifts.

| File | Table | Risk | Notes |
|---|---|---|---|
| `components/ReviewSheet.jsx:78` | `planned_trades` | 🔴 | Selects `notes` — column does not exist. Will 400. |
| `screens/JournalScreen.jsx:96` | `planned_trades` | ✅ fixed | `notes` removed |
| `screens/PerformanceScreen.jsx:99` | `logical_trades` | 🟢 | All standard columns |
| `components/PlanSheet.jsx:130` | `logical_trades` | 🟢 | All standard |
| `screens/DailyViewScreen.jsx:468` | `trades` | 🟢 | Stable IBKR columns |
| `screens/HomeScreen.jsx:34` | `logical_trades` | 🟢 | All standard |

Safe `.select('*')` queries exist in `App.jsx`, `PlansScreen.jsx`, `HomeScreen.jsx`, `JournalScreen.jsx`, `DailyViewScreen.jsx`, `ReviewSheet.jsx`.

---

## Flows to manually test before shipping

1. **Anonymous demo → real account**: anonymous session → seed (should work once C3 is fixed) → sign up → Stripe → verify demo data persists.
2. **IBKR sync end-to-end**: connect IBKR → sync → raw trades in `trades` → logical rebuild → plan matching → adherence computed.
3. **Plan → trade → adherence**: create plan → sync matching execution → verify `matching_status='matched'` and plan vs actual visible in drawer.
4. **Performance → Journal handoff**: select a period in Performance → click a symbol → Journal opens with correct symbol + date range pre-filled.
5. **Paywall race**: complete Stripe → `?checkout=success` polling → verify active state or timeout path.
6. **Esc on all popups**: once M5 is closed.

---

## Daily log

### April 14, 2026

**Shipped:**
- Smart Journal filter bar: symbol autocomplete, direction, asset class, date range (`5ecc0639`)
- Performance "By symbol" uncapped → top 20, clickable rows → Journal handoff (`5ecc0639`)
- Performance period carried into Journal date-range filter when navigating (`b2f9f45b`)
- HomeScreen open positions: removed redundant "at last sync" label (`b2f9f45b`)
- Direction filter fixed (LONG/SHORT uppercase) (`a0426def`)
- `TradeJournalDrawer` gained Esc-to-close (`a0426def`)
- `JournalScreen` column: "Journalled" pill replaced with truncated note preview (`4b66340b`)
- `ShareModal` gained Esc-to-close + Enter-to-share (`08852661`)
- **Bug fix (H1):** `JournalScreen` plans query was silently 400ing on missing `notes` column — plans never loaded → drawer never showed adherence. (`a6a19062`)
- Adherence column added to Smart Journal — colored pill per matched trade, uses stored `adherence_score` with live fallback (`cd9e71ea`)
- `.claude/launch.json` saved for future local dev
- **Security:** RLS migration for 5 previously-exposed tables flagged by Supabase linter — `securities`, `anonymous_sessions`, `ghost_webhook_events`, `user_subscriptions`, `invited_users` (`6955b502`). Sensitive tables locked to service_role only.

**Bugs found but not yet fixed** (logged in audit above):
- C1, C2 — multi-currency P&L wrong on HomeScreen + ReviewSheet
- C3 — seed-demo.js still stale
- H4 — adherence not auto-persisted on match
- H5, H6 — missing error checks on two `.update()` calls
- H7 — ReviewSheet still selects `notes` column
- M5 — Esc missing on 3 popups

**Design / direction decisions:**
- Performance Review screen should be structured around the **weekly review template** a user shared:
  - Top: aggregate KPIs + **Avg adherence** card
  - New: **adherence decomposition** (entry / target / stop / size separately, not averaged) — answers "what's my weakest discipline this week"
  - New: slices by day-of-week + hour-of-day + strategy tag
  - New: weekly reflection textarea saved to a `weekly_reviews` table
  - New: auto-generated "what worked / what didn't" callouts from deterministic rules
- **Step 1 next week:** refactor `adherenceScore.js` to return `{ entry, target, stop, size, overall }` instead of just `overall`. This unlocks the decomposition view.

**Dev notes for future me:**
- When adding a new column that gets queried, search for `.select('...')` calls with explicit column lists and update them — that's how H1 slipped through.
- When inserting into `planned_trades`, remember `strategy` is NOT NULL.
- `logical_trades.opened_at` / `closed_at` are varchar(20) — format as `YYYY-MM-DDTHH:MM:SS` (19 chars).
- When writing a seed SQL script, check `information_schema.columns` first; don't trust `api/seed-demo.js` as a schema reference (it's stale).

**Estimated completion:** ~75% to usable prototype.

---

### April 15, 2026

**Shipped (merges + fixes):**
- Merged 11 files of pre-session work from `pre-session-local-changes` backup branch into main (`5c2ddd1e`) — ReviewSheet (+221 lines), create-checkout-session (+70), DailyViewScreen (+44), plus smaller changes to PlanSheet, App, SettingsScreen, index.css, supabaseAdmin
- `TradeJournalDrawer` replaced with backup version — adds Enter-to-save with smart textarea handling (skips Enter when focus is in INPUT/TEXTAREA/SELECT), uses refs to avoid stale closures
- `PerformanceScreen` got `.maybeSingle()` fix for users without IBKR credentials (bug from backup branch applied on top of today's symbol-navigation work)
- `docs/SETUP.md` (234 lines onboarding doc from backup), `docs/architecture.md`, `docs/backend.md`, `.gitignore` all committed (`5c2ddd1e`, `5780d106`)
- RLS migration applied to live Supabase (`6955b502`)
- **Critical #1** — `ReviewSheet` plans query dropped non-existent `notes` column (`dc7dbc7d`). Same bug as `JournalScreen` fix yesterday; reimported via the backup merge, caught on audit.
- **Critical #2** — HomeScreen + ReviewSheet multi-currency P&L fixed. HomeScreen now fetches `fx_rate_to_base` and `base_currency`, uses `pnlBase(t)` for `todayPnl`. ReviewSheet TradeCard takes `baseCurrency` prop and uses `pnlBase(trade)`. (`193dfc27`)
- **Critical #3** — `api/seed-demo.js` fixed: `notes` → `thesis`, added `strategy: 'Demo'` for NOT NULL constraint. Anonymous demo flow now works end-to-end (`b2395d2d`).
- **Critical #4** — `ReviewSheet.handleMatch`, `handleNoPlan`, and `TradeJournalDrawer.handleSave` now include `.eq('user_id', ...)` and check the `.update()` error before advancing state. Silent failures eliminated. (`4ada87e9`)

**Bugs found but not yet fixed** (from the April 15 audit):
- **⚠️ High — JournalScreen `location.state` mount-only consumption** — `JournalScreen.jsx:95–98`. Second navigation from Performance → Journal with different symbol won't update filter because mount effect already cleared state. Needs a `useEffect` watching `location.state` instead of reading it once.
- **⚠️ High — Adherence score never computed during sync** — `api/rebuild.js` runs `buildLogicalTrades` + plan matching but skips `computeAdherenceScore`. Score only populates when user manually opens drawer and saves. 95% of matched trades have `null` adherence.
- **⚠️ High — No Esc handler on `Sidebar.jsx` and `WelcomeModal.jsx`**.
- **⚠️ New — `totalUnrealized` on HomeScreen line 51 has FX bug for open positions.** Found while fixing Critical #2. `open_positions` table has `currency` but NOT `fx_rate_to_base`, so we can't convert without a schema + `api/sync.js` change. Deferred.
- **🟡 Medium — 3 screens fetch `baseCurrency` independently** — `DailyView`, `Performance`, `Journal`, and now `HomeScreen` + `ReviewSheet`. Candidate for a React context provider.
- **🟡 Medium — `DailyViewScreen:184–187` `daily_notes` upsert has no error handling.**
- **🟡 Medium — `PlanSheet:128–136` historical trades query silently swallows errors.**
- **🟡 Medium — ReviewSheet resets step on close** — user interrupting at step 4 of 6 restarts from 0.
- **🟡 Medium — `api/seed-demo.js` seeds `playbooks` table that no screen reads.** Dead feature — either wire up or drop.
- **🟢 Low — `DailyViewScreen.jsx:72` `openOrderIds` computed but never used.** Dead code.
- **🟢 Low — `TradeJournalDrawer` uses `fmtDateLong` — lossy for same-day trades.**
- **🟢 Low — `docs/architecture.md` lists ReviewSheet as ❌ Esc — stale.**
- **🟢 Low — `docs/backend.md` says `sync.js` "never touches the database" — stale (uses supabaseAdmin now).**
- **🟢 Low — `api/redeem-invite.js` functional but no UI path.** Unclear if planned feature.

**Design / direction decisions:**
- **`notes` vs `thesis` pattern now confirmed universal:** the canonical column is `thesis`. The codebase had `notes` hallucinated in at least 3 places (JournalScreen, ReviewSheet, seed-demo). Grep is now clean. Future copies of this pattern should fail the audit.
- **Decision: keep anonymous demo flow.** `seed-demo.js` stays, now working. This is the "try without signing up" landing experience.
- **Error-check sweep decision:** adopted convention that every client `.update()` / `.insert()` / `.upsert()` call must:
  1. Include `.eq('user_id', ...)` (CLAUDE.md convention)
  2. Destructure `error` from the response
  3. Log + surface error to user (via `alert()` for now) before advancing state
  The three updates fixed in Critical #4 follow this pattern. Extend to the remaining Medium items.

**Dev notes for future me:**
- **Git worktree / main folder lesson:** I work in a worktree under `.claude/worktrees/`. Your "main folder" at `/Users/antonisprotopapas/Desktop/ct3000-react/` is a separate working directory. Changes I make don't appear there until you run `git pull origin main` in that folder. Conversely, edits you make there don't appear in the worktree. Today we hit this when merging the backup branch — 12 files of your uncommitted edits lived only in the main folder.
- **When rescuing uncommitted changes:** create a named branch (`pre-session-local-changes`), push it to origin, then pull main on top. Don't rely on `git stash` for anything you care about.
- **Schema drift keeps biting:** same `notes` column bug hit twice in 24 hours (JournalScreen yesterday, ReviewSheet today). Root cause: explicit column lists in `.select()`. Mitigation: prefer `select('*')` per CLAUDE.md, grep whole codebase when touching schema-related code.
- **Supabase database linter exists** — visit the Security page in the dashboard regularly. Today's RLS issues had been there since the tables were created; no one had checked.

**Continued work later on April 15 (quality sweep):**

- **Native vs base currency, corrected:** `TradeJournalDrawer`, Journal row P&L column, Journal `calcR`, ReviewSheet TradeCard now all show **native currency** for single-trade views. Aggregates (HomeScreen today's P&L, Performance KPIs, cumulative chart) stay in base. R-multiple numerator now uses native P&L so it shares units with the native risk denominator — previously silently scaled by fx_rate for non-base trades. (`c9401e72`)
- **Workflow doc:** new `docs/WORKFLOW.md` — 643-line file/function map with user flows, data-flow diagram, and "who reads/writes each table" matrix. Reader guide for the non-expert project owner. (`7bb1be3e`)
- **Esc handlers closed:** `Sidebar` and `WelcomeModal` now close on Escape. WelcomeModal also fires "Connect IBKR" on Enter. Every popup/drawer now has keyboard support. (`46fee411`)
- **JournalScreen `location.state` fix:** filter now updates on every navigation via `useEffect(…, [location.state])` instead of only at mount. Second click from Performance on a different symbol updates the filter correctly. (`46fee411`)
- **🎯 Adherence auto-computed during sync:** `api/rebuild.js` now calls `computeAdherenceScore(plan, trade)` for every matched closed trade, writing `adherence_score` alongside the upsert. New `api/lib/adherenceScore.js` (CommonJS mirror of `src/lib/adherenceScore.js`). This was the biggest architectural gap — closed. (`46fee411`)
- **🎯 review_notes preservation across rebuild:** rebuild.js previously did delete → insert, silently wiping user journal notes and manual match overrides on every sync. Now fetches existing logical_trades first, keys by `(opening_ib_order_id, conid)`, and restores `review_notes` + `matching_status='manual'` on the new rows before insert. Data-loss bug closed. (`aca8dd42`)
- **BaseCurrency context provider:** new `src/lib/BaseCurrencyContext.js`. App shell wraps consumers in `<BaseCurrencyProvider>`. HomeScreen, DailyViewScreen, JournalScreen, PerformanceScreen dropped their local fetch + state. Net: 5 queries per app load → 1. (`989b788f`)
- **Error handling sweep (Medium items):** `DailyViewScreen.persistNote`, `PlanSheet` historical trades query now check `.error` and surface failures instead of swallowing. (`989b788f`)

**Audit status end-of-day April 15:**

- ✅ Closed: all 4 Critical, all 3 High from morning audit, 3 Medium (baseCurrency context, daily_notes error, PlanSheet error), 1 brand-new High (review_notes wipe) discovered and fixed same day, Esc on Sidebar + WelcomeModal.
- ⚠️ Still open:
  - **New bug found today:** `totalUnrealized` on HomeScreen line 51 has an FX bug for open positions. `open_positions` table stores `currency` but not `fx_rate_to_base`, so we can't convert without a schema + `api/sync.js` change. Needs design.
  - **Architectural:** `docs/backend.md` says `api/sync.js` "never touches the database" — stale (uses `supabaseAdmin` now). Sweep the docs.
  - **Dead-ish:** `api/seed-demo.js` inserts into `playbooks` table that no screen reads. Either wire up or drop.
  - **Low:** `TradeJournalDrawer` uses `fmtDateLong` (lossy for same-day trades).
  - **Question:** `api/redeem-invite.js` exists but no UI path. Planned or abandoned?
  - **Still medium:** ReviewSheet resets step on close (UX nit for interrupted reviews).

**Commits shipped today (chronological):**

| Commit | Scope |
|---|---|
| `5c2ddd1e` | Merge pre-session backup branch (11 files, +482 lines) |
| `5780d106` | Commit .gitignore + docs/architecture.md + docs/backend.md from main folder |
| `6955b502` | RLS migration for 5 flagged tables |
| `c2c3e8d3` | Log RLS in README |
| `dc7dbc7d` | Critical #1: ReviewSheet `notes` column fix |
| `193dfc27` | Critical #2: HomeScreen + ReviewSheet multi-currency aggregate fix |
| `b2395d2d` | Critical #3: seed-demo.js `thesis` + `strategy` |
| `4ada87e9` | Critical #4: user_id + error handling on .update() calls |
| `331f2785` | README April 15 daily log |
| `7bb1be3e` | docs/WORKFLOW.md — full file/function map |
| `c9401e72` | Single-trade native currency fix (drawer, journal row, review card) |
| `46fee411` | Audit sweep: Esc on Sidebar/Welcome, location.state, adherence-in-rebuild |
| `aca8dd42` | review_notes preservation across rebuild |
| `989b788f` | BaseCurrency context + error handling sweep |

**Dev notes for future me:**
- **rebuild.js does delete + insert** — any new user-data column added to `logical_trades` must be added to the preservation logic in rebuild.js (currently preserves `review_notes` and manual matching). Grep for `preservedByKey` when touching the schema.
- **Native vs base rule of thumb:** if the surface shows ONE trade → native (`trade.currency`, `trade.total_realized_pnl`). If it sums/aggregates trades → base (`pnlBase(t)`, `useBaseCurrency()`).
- **BaseCurrency must come from context now** — don't fetch it per-screen. `useBaseCurrency()` from `src/lib/BaseCurrencyContext`.
- **Two copies of adherence + builder in src/lib and api/lib** — if you change the algorithm, change both. Consider unifying via a shared folder or transpilation if this gets painful.

**Estimated completion:** ~82%. Significant progress on quality today — moved from "working but fragile" to "working with known-small-list-of-bugs." Feature work (adherence decomposition for Performance Review) next.

---

### April 15–16, 2026 (afternoon session → past midnight)

**Major features shipped:**

- **Adherence decomposition on Performance** — refactored `adherenceScore.js` to return `{ entry, target, stop, size, overall }` via `computeAdherenceBreakdown()`. Legacy `computeAdherenceScore()` kept as scalar shortcut. New "Avg adherence" KPI card (5th slot in top row, green/amber/red thresholds). New "Adherence breakdown" panel below the cumulative chart — 4 horizontal bars showing entry/target/stop/size pillar averages with one-line descriptions and color coding. (`d267a2fa`)
- **Trade review pipeline block on HomeScreen** — replaces the one-line amber banner. Three navigation boxes: Need matching (amber → `/review`), Need notes (blue → `/journal` pre-filtered to "Not journalled"), Fully done (green → `/journal` default). Counts from closedLast30. Hidden when pipelineTotal === 0. JournalScreen taught to accept `activeFilter` via `location.state`. (`66b7716a`)
- **Bulk mark-off-plan in Smart Journal** — checkbox selection on unmatched/ambiguous trades + sticky blue action bar with "Mark as off-plan" button. Bulk `.update().in('id', ids)` with confirmation dialog + error handling. Clears selection after commit. (`dc955860`)
- **`/review` full-page route** — ReviewSheet bottom drawer ripped out, replaced with `ReviewScreen.jsx` as a proper page at `/review`. Back button, keyboard shortcuts (Enter/N/Esc), progress dots, same wizard logic. Deleted `ReviewSheet.jsx` + `TradeJournalDrawer.jsx` (both orphaned). (`6e664e56`)
- **Smart Journal: Journalled pill reverted** — note preview column was too busy, went back to the clean green "Journalled" pill (note still on hover via title attribute). (`69bf8910`)
- **Smart Journal: inline row expansion** — replaced the bottom drawer with click-to-expand rows in the table. New `TradeInlineDetail.jsx` component. Chevron indicator, only one row open at a time, Cmd+Enter saves, Esc collapses, "Unsaved changes" badge, 4-state save button. (`6897ee8e`, `569ffa24`, `29fd7f55`)
- **Thesis label in inline detail** — plan thesis was rendering as unlabeled italic text, now has a proper "THESIS" header. (`5e6a2a02`)
- **Adherence pill height stabilization** — null branch now uses same padding as the scored branch so row height doesn't jitter when filters switch between mixed sets. (`30b09ed3`)
- **Human-readable option symbols** — new `fmtSymbol(trade)` in formatters.js parses OSI "NVDA 260330P00170000" → "NVDA 170P 30 Mar". + `AssetBadge` component for non-STK trades (OPT/FX/CASH/FUT badges). (`b55efc41`)
- **Smart Journal filter redesign** — dropped Unmatched/Ambiguous/Journalled, added "Needs review" (action queue) + "Off-plan" (discipline signal). New `planPillFor(trade)` helper maps matching_status × has-plan into 4 display labels (Matched/Needs review/Off-plan/Auto). Dropped "Open" tab (SJ is closed trades only). Renamed "Closed" → "All" (since everything in SJ is closed). (`d705b59e`, `d1f76504`, `a3d7199a`)
- **Reset match action** in TradeInlineDetail — "Reset match" link for resolved trades, flips back to `unmatched`, clears planned_trade_id + adherence_score, preserves review_notes. Confirmation dialog. (`28a53917`)
- **IBKR sync lag notice** — success banner now explains Flex Query latency (10–30 min for new fills). (`28a53917`)
- **fx_rate_to_base on open_positions** — `parseOpenPositions` in sync.js now reads `fxRateToBase` from XML, IBKRScreen writes it per position, HomeScreen `totalUnrealized` converts via `(unrealized_pnl * fx_rate_to_base)`. Migration added. (`f1f65f7a`)
- **Redeem-invite bug fix** — `redeemed_by_user_id` → `redeemed_by` column name mismatch. Schema migration + `docs/INVITE_FLOW.md` (rewritten to reflect ct3000-admin split). (`3a290dc1`, `70e142ce`)

**Mobile polish (pre-beta):**
- Removed duplicate privacy toggle from MobileNav (keep in Header only)
- Smart Journal: progressive column hiding — 4 cols on phones, 7 on tablets, 11 on desktop
- Performance by-symbol: tighter padding on mobile
- Explicit `/signup` route for invite link robustness
(`ac5a05c7`)

**Pre-beta audit result:** no ship-blockers found. All cross-screen flows verified (pipeline block, review flow, reset match, invite redemption, empty states, multi-currency). One documented caveat: fx_rate_to_base is NULL on pre-migration open_positions rows until user syncs. New beta users are unaffected (start fresh).

**Design decisions:**
- **SJ is for closed trades only.** Open positions belong on Home / DailyView. Removed the "Open" tab.
- **Native currency for single trades, base for aggregates.** Enforced everywhere.
- **Filter semantics reworked.** "Needs review" = pending action (unmatched + ambiguous). "Off-plan" = user confirmed no plan (the real discipline signal). "Matched" = plan linked. Each filter answers a distinct question.
- **The review pipeline has 2 user verbs:** Match (via `/review` wizard or auto) + Journal (via SJ inline expansion). Pipeline block on Home makes this explicit.
- **Invite creation is ct3000-admin's job.** This repo only handles redemption.

**Dev notes for future me:**
- **`computeAdherenceBreakdown()` is the new primary export.** Returns `{ entry, target, stop, size, overall }`. `computeAdherenceScore()` is a scalar shortcut that returns `.overall`. Both exist in `src/lib/` (ES module) and `api/lib/` (CJS mirror). Change both when touching the algorithm.
- **Smart Journal colSpan is now 11** (was 10) because of the checkbox column. If you add/remove columns, update the colSpan on the inline-expansion `<td>`.
- **Responsive columns in SJ use `hidden sm:table-cell` / `hidden md:table-cell` pattern.** Each column has its own breakpoint class on both `<th>` and `<td>`.
- **The `/signup` route is explicit but does nothing when logged in** — just redirects to `/`. The invite flow works because when logged OUT, `App.jsx` returns `<AuthScreen />` directly before routes are evaluated, and AuthScreen reads `?invite=` from `window.location.search`.

**Estimated completion:** ~88–90%. Beta-ready for invited users. Remaining: weekly reflection textarea, by-day/by-hour slices, auto-generated callouts (all post-beta).

---

### Template for future daily entries

Copy this block for each new day:

```markdown
### [Date]

**Shipped:**
- [feature / fix] (`commit hash`)

**Bugs found but not yet fixed:**
- [ref audit section]

**Design / direction decisions:**
- [what and why]

**Dev notes for future me:**
- [gotchas, lessons learned]
```

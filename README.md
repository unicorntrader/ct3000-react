# CT3000

A trading journal for traders on Interactive Brokers. Plan trades before taking
them, auto-import executions from IBKR, review each trade with an adherence
score comparing plan vs. actual.

React + Supabase + Stripe, hosted on Vercel.

**Status:** private BETA as of April 22, 2026. Public launch pending legal
review of Terms / Privacy and production SMTP setup.

---

## Quick start

### Prerequisites
- Node.js 18+
- A Supabase project (free tier is fine)
- A Stripe account (test mode is fine for local dev)
- Optional: a Sentry project for error tracking

### Clone and install
```bash
git clone https://github.com/unicorntrader/ct3000-react.git
cd ct3000-react
npm install
```

### Environment variables

Create `.env.local` at the repo root:

```bash
# Client (baked into the browser bundle — VITE_ prefix required by Vite)
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=ey...
VITE_SENTRY_DSN=https://...ingest.sentry.io/...   # optional

# Server (serverless functions under api/)
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=ey...
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
SENTRY_DSN=https://...ingest.sentry.io/...             # optional

# Optional with sensible fallbacks
ALLOWED_ORIGIN=http://localhost:3000                   # CORS allow-list
APP_URL=http://localhost:3000                          # Stripe return URL
STRIPE_PRICE_ID=price_...                              # has hardcoded fallback
```

### Database schema

Run the migrations in `supabase/migrations/` against your Supabase project,
in filename order (they're timestamp-prefixed). The `00000000000000_baseline_schema.sql`
file is the reference snapshot — apply it once to a fresh project.

### Run locally

```bash
npm start          # React dev server on :3000
vercel dev         # Full stack including serverless functions (recommended)
```

Use `vercel dev` if you want the `/api/*` endpoints to work — `npm start`
alone only serves the React app.

### Deploy

Push to `main`. Vercel auto-deploys on push. Branch deploys get preview URLs.

Required Vercel env vars (Settings → Environment Variables → Production):
`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `STRIPE_SECRET_KEY`,
`STRIPE_WEBHOOK_SECRET`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.

---

## What to read first

1. **`CLAUDE.md`** (repo root) — conventions + gotchas. Required reading
   before touching code. Includes the "every Supabase query must filter
   by `user_id`" rule, the canonical column names, and the standard
   data-loading pattern.
2. **`docs/how-it-works.md`** — plain-English tour of the whole app,
   written for product owners but also good first-pass orientation for
   a new dev (~4 pages).
3. **This README** (the Architecture section below) — code-level map.
4. **`docs/BACKLOG.md`** — known issues, deferred improvements,
   pre-public-launch todos.

---

## Architecture

### Data flow

```
IBKR Flex Query (XML)
      │
      ▼
  api/sync.js         ← Vercel serverless, parses XML
      │
      ▼
  trades              ← raw IBKR executions
      │
      ▼
  api/rebuild.js
    + api/_lib/logicalTradeBuilder.js   ← FIFO matching
    + api/_lib/adherenceScore.js        ← plan vs actual scoring
      │
      ▼
  logical_trades      ← round-trip positions with adherence scores
      │
      ▼
  React screens       ← HomeScreen, JournalScreen, etc.
```

The browser never runs FIFO or adherence scoring. It only reads from
`logical_trades`, which the server writes during Rebuild.

### Tables (Supabase)

Core trading data:
- `trades` — raw IBKR executions; includes `fx_rate_to_base`, `currency`
- `logical_trades` — FIFO-matched positions; includes `adherence_score`,
  `matching_status` (`matched` / `needs_review` / `off_plan`), `planned_trade_id`,
  `user_reviewed`, `multiplier`
- `open_positions` — current open positions from IBKR
- `securities` — instrument metadata cache (conid, symbol, multiplier,
  currency, underlying_*)

Plans & matching:
- `planned_trades` — user plans. Canonical columns:
  `planned_entry_price`, `planned_stop_loss`, `planned_target_price`,
  `planned_quantity`. **Old aliases (`entry_price`, `stop_price`, etc.)
  do not work.**
- `playbooks` — reusable trade setups, referenced by `planned_trades.playbook_id`
- `missed_trades` — trades the user wanted but didn't take (table exists,
  no UI yet)

Journaling & review:
- `daily_notes` — per-day notes (unique per user+date_key)
- `weekly_reviews` — weekly retrospective (worked/didnt_work/recurring/action)

User & account:
- `user_ibkr_credentials` — IBKR token, account_id, `last_sync_at`, `base_currency`
- `user_subscriptions` — Stripe state, `is_comped`, `ibkr_connected`, `demo_seeded`
- `invited_users` — beta invite tokens
- `account_deletions` — churn log. Email + `stripe_customer_id` are
  no longer captured on new deletions (set to `null` in
  `api/delete-account.js` after the 2026-04-25 privacy update). The
  weekly `api/cron-anonymize-churn.js` job scrubs any pre-cutover
  rows older than 90 days. Feedback text persists indefinitely.

Ops:
- `admin_actions` — admin moderation audit log
- `app_settings` — global key/value store
- `ghost_webhook_events` — inbound webhook events from Ghost CMS
- `daily_adherence` — per-day adherence aggregates (on `tradesquares`
  branch, not yet merged)

All tables have RLS enabled. User-facing tables filter by `user_id`; admin
tables (`invited_users`, `admin_actions`, `ghost_webhook_events`) are
service-role-only.

### Serverless functions (under `api/`)

All endpoints are POST (or DELETE where noted) and return JSON. Auth is
via Bearer Supabase JWT unless noted otherwise.

| Endpoint | Purpose |
|---|---|
| `/api/sync` | **Server-authoritative.** Authenticates JWT, gates on active subscription, fetches IBKR Flex XML, parses, upserts `trades`, replaces `open_positions`, clears demo rows, updates `user_ibkr_credentials`, calls rebuild. Returns a summary `{ tradeCount, openPositionCount, logicalCount, newTradeCount, newTradesPreview, rebuildWarnings }` — no raw trades to the browser. |
| `/api/rebuild` | Rebuilds `logical_trades` from raw trades; applies plan matching + adherence scoring. Subscription-gated. |
| `/api/ibkr-credentials` | POST upsert / DELETE remove a user's IBKR Flex token + queryId. Server-only writes via service_role; the browser cannot insert/update/delete this table directly. |
| `/api/stripe-webhook` | Handles subscription lifecycle events (Stripe signature auth, not Bearer) |
| `/api/create-checkout-session` | Creates Stripe customer + Checkout session with 7-day trial |
| `/api/billing-portal` | Creates Stripe Billing Portal session for self-service |
| `/api/delete-account` | Full GDPR wipe — captures feedback (email + stripe_customer_id NOT recorded post-2026-04-25), deletes all user data, then the auth record |
| `/api/redeem-invite` | Redeems an invite token and creates a comped account |
| `/api/seed-demo` | Populates demo data for new users pre-IBKR-connect |
| `/api/cron-sync` | Nightly cron (CRON_SECRET auth). Loops users with auto-sync on, skips inactive subscriptions. |
| `/api/cron-anonymize-churn` | Weekly cron. Strips `email` + `stripe_customer_id` from `account_deletions` rows older than 90 days. |
| `/api/maintenance-status` | Public, no auth. Returns the global maintenance flag from `app_settings`. |

Helpers in `api/_lib/` (underscore-prefix → not counted as functions by
Vercel): `supabaseAdmin.js`, `stripe.js`, `sentry.js`,
`logicalTradeBuilder.js`, `rebuildForUser.js`, `performUserSync.js`,
`requireActiveSubscription.js`, `exchangeTimezone.js`,
`adherenceScore.js`.

Function timeouts (in `vercel.json`): `sync`, `rebuild`,
`debug-flex-xml`, `cron-sync` get 60s; `cron-anonymize-churn` gets 30s;
others use the Vercel default.

### Client screens (under `src/screens/`)

| Screen | Purpose |
|---|---|
| `HomeScreen` | Dashboard — KPI cards, open positions, active plans, trade-review pipeline |
| `PlansScreen` | Plan list + symbol search |
| `DailyViewScreen` | Day-by-day trade breakdown + daily notes |
| `JournalScreen` | Closed trades with filters, inline expand, bulk actions |
| `PerformanceScreen` | Stats, cumulative P&L curve, 12 auto-insights, weekly reflection |
| `ReviewScreen` | Triage wizard for `needs_review` trades |
| `IBKRScreen` | Connection management |
| `SettingsScreen` | Account + Subscription + Support + Legal + Danger zone |
| `TermsScreen` / `PrivacyScreen` | Public legal pages (pre-auth accessible) |
| `PaywallScreen` | Post-trial / inactive subscription state |
| `AuthScreen` | Signup / login / invite redemption / password reset |

### Key client libraries (under `src/lib/`)

- `formatters.js` — `pnlBase()`, `fmtPnl`, `fmtPrice`, `fmtDate`,
  `fmtShort`, `currencySymbol`, `fmtSymbol`. Single source of truth for
  display formatting and FX conversion.
- `DataVersionContext.jsx` — cross-screen data invalidation. Mutations
  bump a version counter; watching screens silently refetch. Keys:
  `trades`, `plans`, `positions`, `playbooks`, `notes`, `ibkrCreds`.
- `BaseCurrencyContext.jsx` — fetches user's base currency once at
  app-shell level; never re-fetch per screen.
- `PrivacyContext.jsx` — global toggle for masking dollar amounts.
- `constants.js` — `SUPPORT_EMAIL`, `APP_VERSION`, `supportMailto()`.

### Routing & keep-alive navigation

React Router 7. The top-level route layer in `AppShell` uses a keep-alive
pattern: every visited screen stays mounted after first visit, and tab
switches toggle CSS `display` rather than unmounting. First visit pays
the fetch cost (one spinner); every subsequent visit is instant with
preserved state (scroll position, form drafts, expand/collapse state).

Cross-screen mutations use `DataVersionContext` to trigger **silent**
refetches — no spinner, old data stays visible while new data loads in
the background.

Public routes (accessible without auth): `/terms`, `/privacy`. Everything
else is behind the session + active-subscription gate in `src/App.jsx`.

---

## Stack

_Versions match `package.json` at the time of the last docs sync; check the file for the live values._

| Layer | Choice | Version (semver range) |
|---|---|---|
| UI framework | React | ^18.2.0 |
| Routing | react-router-dom | ^7.14.0 |
| Styling | Tailwind CSS | ^3.3.0 |
| Charts | Recharts | ^3.8.1 |
| State | React Context (no Redux/Zustand) | — |
| Build | Vite | ^8.0.10 |
| Client SDK | @supabase/supabase-js | ^2.45.4 |
| Server runtime | Node.js on Vercel | 18+ |
| Payments | Stripe | ^22.0.1 |
| XML parsing | fast-xml-parser | ^5.7.1 |
| Date / TZ | date-fns-tz | ^3.x |
| Error tracking | Sentry (@sentry/react + @sentry/node) | ^10.48 / ^10.49 |
| Hosting | Vercel Pro | — |
| Database | Supabase (PostgreSQL) | — |
| Auth | Supabase Auth | — |
| External data | IBKR Flex Query (XML over HTTPS) | — |

---

## Conventions (abridged — full list in `CLAUDE.md`)

- **All Supabase queries must include `.eq('user_id', ...)`.** No exceptions.
- **`select('*')` is safe**; explicit column lists will 400 if a column
  doesn't exist.
- **Silent errors:** always check the `error` field on Supabase responses.
  `PGRST116` (no rows) is expected for new users, not a failure.
- **Format functions require a currency.** `fmtPnl(n, currency)` and
  `fmtPrice(n, currency)` render `¤` for missing currency so the bug is
  immediately visible.
- **P&L aggregation** always goes through `pnlBase(t)` to respect
  `fx_rate_to_base`. Single-trade display uses native P&L.
- **Direction values are uppercase**: `LONG` / `SHORT`.
- **`matching_status` vocabulary** is 3 mutually exclusive states:
  `matched`, `needs_review`, `off_plan`. User-reviewed decisions survive
  rebuilds via the `user_reviewed` boolean.
- **No dynamic `await import()`** — static imports only (webpack chunk
  hash issues on deploy).
- **Canonical column names**: `planned_entry_price`, `planned_stop_loss`,
  `planned_target_price`, `planned_quantity`, `thesis`. Old aliases do
  not work.

### Standard data-loading pattern (required)

Every `useEffect` that fetches from Supabase uses this shape:

```js
import * as Sentry from '@sentry/react';
import LoadError from '../components/LoadError';
import { useDataVersion, useInitialLoadTracker } from '../lib/DataVersionContext';

const [loading, setLoading] = useState(true);
const [loadError, setLoadError] = useState(null);
const [reloadKey, setReloadKey] = useState(0);
const [tradesV] = useDataVersion('trades');
const loadTracker = useInitialLoadTracker(reloadKey);

useEffect(() => {
  if (!userId) return;
  const isInitial = loadTracker.isInitial;
  if (isInitial) setLoading(true);
  setLoadError(null);
  (async () => {
    try {
      const res = await supabase.from('...').select('*').eq('user_id', userId);
      if (res.error) throw res.error;
      setData(res.data || []);
    } catch (err) {
      console.error('[screen-name] load failed:', err?.message || err);
      Sentry.withScope((scope) => {
        scope.setTag('screen', 'screen-name');
        scope.setTag('load_kind', isInitial ? 'initial' : 'silent-refetch');
        Sentry.captureException(err instanceof Error ? err : new Error(String(err)));
      });
      if (isInitial) setLoadError(err?.message || 'Could not load.');
    } finally {
      if (isInitial) setLoading(false);
      loadTracker.markLoaded();
    }
  })();
}, [userId, reloadKey, tradesV]);  // eslint-disable-line react-hooks/exhaustive-deps

if (loadError) return <LoadError title="..." message={loadError} onRetry={() => setReloadKey(k => k + 1)} />;
if (loading)   return <Spinner />;
```

---

## Repo layout

```
.
├── api/                        serverless functions
│   ├── _lib/                   shared helpers (Vercel-ignored)
│   └── *.js                    one file = one endpoint
├── src/
│   ├── components/             reusable UI (Sidebar, Header, PlanSheet, modals, …)
│   ├── lib/                    client helpers + contexts
│   ├── screens/                top-level page components
│   ├── App.jsx                 auth gate + routing
│   └── index.jsx               entry point (Sentry init, BrowserRouter)
├── supabase/
│   └── migrations/             SQL migrations (apply in filename order)
├── docs/                       architecture notes, backlog, audits
├── public/                     static assets (referenced as /...)
├── index.html                  Vite entry HTML at repo root
├── vite.config.js              Vite build / dev config
└── vercel.json                 function config + SPA rewrites
```

---

## Active branches

- `main` — production. Deploys automatically to the live URL.
- `tradesquares` — in-progress "discipline heatmap" feature. On ice until
  ready to launch. Full TradeSquares component + migration + rebuild
  integration. One migration away from going live.
- `learn-the-code` — in-app code labels / learning mode. Separate experiment.

---

## Support

- Support email: `thinker@philoinvestor.com` (placeholder — moving to
  `support@cotraderapp.com` pre-public-launch)
- Legal entity: Philo Holdings Ltd, Cyprus
- Status: private BETA, inviting users now

For anything code-related, start with `CLAUDE.md` and `docs/how-it-works.md`.

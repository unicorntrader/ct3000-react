# CT3000 — IBKR Trading Journal

CT3000 is a personal trading journal and analytics platform built for Interactive Brokers (IBKR) users. It connects directly to the IBKR Flex Web Service API, imports your trade history automatically, organises executions into logical trades using FIFO matching, lets you document trade plans before you enter, and gives you a performance dashboard with cumulative P&L, win rate, and per-symbol breakdowns.

**Who it is for:** Individual traders who use IBKR and want a structured way to plan, track, review, and analyse their trades — all in one place.

---

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | React 18, Create React App |
| Styling | Tailwind CSS 3, DM Sans font |
| Charts | Recharts 3 |
| Auth & DB | Supabase (PostgreSQL + Auth) |
| Serverless API | `/api/sync.js` — Vercel Serverless Function (Node.js) |
| Hosting | Vercel (inferred from `vercel.json`) |
| IBKR data source | IBKR Flex Web Service XML API |

---

## Repository structure

```
ct3000-react/
├── index.html               # Vite entry HTML at repo root
├── vite.config.js           # Vite build / dev config
├── api/                     # Vercel serverless functions
│   ├── sync.js                       # Server-authoritative IBKR sync
│   ├── rebuild.js                    # Standalone rebuild endpoint
│   ├── ibkr-credentials.js           # POST/DELETE for IBKR token + queryId
│   ├── stripe-webhook.js             # Stripe lifecycle handler
│   ├── create-checkout-session.js
│   ├── billing-portal.js
│   ├── delete-account.js             # GDPR full-wipe
│   ├── redeem-invite.js
│   ├── seed-demo.js
│   ├── cron-sync.js                  # Nightly auto-sync
│   ├── cron-anonymize-churn.js       # 90-day churn-data scrub
│   ├── maintenance-status.js
│   └── _lib/                         # Shared helpers (Vercel-ignored)
│       ├── supabaseAdmin.js
│       ├── stripe.js
│       ├── sentry.js
│       ├── requireActiveSubscription.js
│       ├── performUserSync.js
│       ├── rebuildForUser.js
│       ├── logicalTradeBuilder.js    # FIFO matcher
│       ├── adherenceScore.js
│       └── exchangeTimezone.js       # IBKR venue → IANA tz map
├── public/                  # Static assets served from /
├── src/
│   ├── index.jsx            # React entry point (Sentry init, BrowserRouter)
│   ├── index.css            # Global styles + Tailwind directives
│   ├── App.jsx              # Auth gate + React Router routes
│   ├── components/
│   │   ├── AuthScreen.jsx   # Login / signup / forgot-password form
│   │   ├── Header.jsx
│   │   ├── MobileNav.jsx
│   │   ├── Sidebar.jsx
│   │   ├── PlanSheet.jsx
│   │   └── ...
│   ├── screens/
│   │   ├── HomeScreen.jsx
│   │   ├── PlansScreen.jsx
│   │   ├── DailyViewScreen.jsx
│   │   ├── JournalScreen.jsx
│   │   ├── PerformanceScreen.jsx
│   │   ├── IBKRScreen.jsx
│   │   ├── ReviewScreen.jsx
│   │   ├── ResetPasswordScreen.jsx   # Recovery-link landing page
│   │   ├── SettingsScreen.jsx
│   │   ├── PaywallScreen.jsx
│   │   ├── TermsScreen.jsx
│   │   └── PrivacyScreen.jsx
│   └── lib/
│       ├── supabaseClient.js          # Reads import.meta.env.VITE_* vars
│       ├── formatters.js              # Formatting + multi-currency helpers
│       ├── BaseCurrencyContext.jsx
│       ├── DataVersionContext.jsx     # Cross-screen silent refetch
│       ├── PrivacyContext.jsx         # Privacy-mask toggle
│       └── constants.js
├── supabase/migrations/     # Dated SQL migrations (run in filename order)
├── package.json
├── tailwind.config.js
├── postcss.config.js
├── vercel.json              # framework: vite, outputDirectory: dist
└── docs/                    # This documentation
```

---

## Prerequisites

- **Node.js** 18+ and npm
- A **Supabase** project (free tier is fine)
- An **Interactive Brokers** account with Flex Web Service enabled
- A **Vercel** account (for deployment) or any host that supports Node serverless functions

---

## Step-by-step setup from zero

### 1. Clone and install

```bash
git clone <your-repo-url> ct3000-react
cd ct3000-react
npm install
```

### 2. Create a Supabase project

1. Go to [supabase.com](https://supabase.com) and create a new project.
2. In the Supabase dashboard, open the **SQL Editor** and run the schema from `docs/database.md` to create all required tables.
3. Enable **Email/Password Auth** under Authentication > Providers.

### 3. Set environment variables

Create a `.env` file at the project root (never commit this file):

```env
VITE_SUPABASE_URL=https://xxxxxxxxxxxxxxxxxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

Both values are found in your Supabase project under **Settings > API**.

### 4. Run locally

```bash
npm start
```

The app opens at `http://localhost:3000`. The `/api/sync` endpoint does **not** run locally with `npm start` — you need either Vercel CLI or a manual test. See the Development Workflow section.

### 5. Connect IBKR credentials

1. Log in to [IBKR Client Portal](https://www.interactivebrokers.com/portal).
2. Go to **Performance & Reports → Flex Queries**.
3. Click **Flex Web Service Configuration** → Enable the service and copy your **Token**.
4. Click **Create a new Activity Flex Query**, include Trades and Open Positions sections with **all fields** enabled, then note the **Query ID**.
5. In the running app, go to the **IBKR** screen and enter both values.

### 6. Sync trades

Click **Sync now** on the IBKR screen. The browser sends a Bearer-JWT
POST to `/api/sync`. The server authenticates, gates on active
subscription, fetches IBKR XML, parses, persists trades + positions,
updates credentials, runs FIFO + plan-matching, and returns a summary
showing how many fills are new since the last sync. The browser does
not write trade data itself.

---

## Development workflow

### Run the frontend only

```bash
npm start          # Starts the Vite dev server on port 3000
# (npm run dev is the same; both alias to `vite`)
```

### Test the API locally

Install Vercel CLI and run:

```bash
npm install -g vercel
vercel dev         # Runs both the Vite frontend AND /api/* on port 3000
```

### Build for production

```bash
npm run build      # Vite builds to dist/
npm run preview    # Local preview of the built bundle
```

---

## Usage walkthrough

1. **Sign up / Log in** — Create an account at the Auth screen. Confirm your email via the Supabase-sent link.
2. **Connect IBKR** — Navigate to the IBKR screen (hamburger menu → Manage IBKR connection, or top-right menu icon). Paste your Flex Token and Query ID. Tap **Test first** to verify connectivity, then **Connect IBKR**.
3. **Sync trades** — With credentials saved, tap **Sync now**. This fetches up to 30 days of trade history (determined by the Query ID period you configured in IBKR).
4. **Create plans** — Before placing a trade, tap **+ New plan** on the Plans screen. Enter ticker, direction, entry, target, stop, and quantity. The live R:R calculator shows risk/reward in real time.
5. **Review the home dashboard** — The Home screen shows today's P&L, open positions, active plans, and 30-day win rate. An amber banner appears when trades need review.
6. **Review unmatched trades** — Tap the amber banner (or the banner on the Home screen) to open the Review wizard. Step through each unmatched or ambiguous trade and either link it to a plan or mark it as unplanned.
7. **Daily View** — Browse trades day-by-day. Click any row to expand raw execution details (exec price, quantity, commission, exec ID). Use the Resolve button for any remaining unmatched trades.
8. **Journal** — Filter your full trade history by outcome (Wins, Losses), match status (Matched, Unmatched, Ambiguous), or status (Open). Inspect R-multiples for matched trades.
9. **Performance** — View cumulative P&L chart, net P&L, win rate, avg win/loss ratio, and expectancy. Filter by 1D / 1W / 1M / 3M / All or a custom date range. Drill into per-symbol, per-direction, and per-asset-class breakdowns.
10. **Settings** — View your base currency (detected from IBKR) and IBKR account ID.

---

## Deployment notes

The app is designed for **Vercel**. The `vercel.json` declares:

```json
{
  "buildCommand": "npm run build",
  "outputDirectory": "dist",
  "framework": "vite"
}
```

Vercel automatically picks up every `.js` file under `/api/` as a
serverless function. Files under `api/_lib/` (underscore-prefixed) are
not counted as functions — they're shared helpers.

### Deploy steps

```bash
# One-time: install and authenticate
npm install -g vercel
vercel login

# Deploy
vercel --prod
```

After the first deployment, set the environment variables in the Vercel dashboard under **Project Settings > Environment Variables**:

| Name | Value |
|---|---|
| `VITE_SUPABASE_URL` | Your Supabase project URL (browser-exposed) |
| `VITE_SUPABASE_ANON_KEY` | Your Supabase anon key (browser-exposed) |
| `VITE_SENTRY_DSN` | Sentry browser DSN (optional — errors + ErrorBoundary) |
| `SUPABASE_URL` | Same URL as above (server-side) |
| `SUPABASE_SERVICE_ROLE_KEY` | Service-role key for server endpoints |
| `STRIPE_SECRET_KEY` | Stripe API key (server-side) |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret |
| `SENTRY_DSN` | Sentry server DSN for `/api/*` functions (optional) |
| `CRON_SECRET` | Bearer token used by Vercel's cron scheduler |
| `ALLOWED_ORIGIN` | Production app URL (CORS allow-list) |
| `APP_URL` | Same URL — used in Stripe return URLs |

**Sentry setup:**

The app wires Sentry for both the browser (`@sentry/react`) and the serverless
functions (`@sentry/node` via `api/_lib/sentry.js`). Both are no-ops when their
respective env vars are absent, so local dev and preview deploys work without
a Sentry project.

Recommended: create **one Sentry project** (platform: JavaScript → React) and
use the same DSN for both `REACT_APP_SENTRY_DSN` and `SENTRY_DSN`. Issues are
tagged with `route=sync|rebuild` and `sync_step=flex-fetch|trades-upsert|…` so
you can filter server errors from browser errors in the UI. User context
(Supabase `user_id`, email) is attached to every event.

See `docs/deployment.md` for full details.

---

## Troubleshooting

**"Supabase env vars not set. Auth will not function."**
You have not created the `.env` file or the variable names are incorrect. They must be `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (Vite-prefixed). The historic `REACT_APP_` prefix is no longer accepted.

**Sync fails with "SendRequest failed"**
Your IBKR Flex Token or Query ID is wrong, or the Flex Web Service is not enabled in IBKR. Double-check both under Client Portal > Flex Queries.

**Sync times out after 10 attempts**
IBKR sometimes takes longer than 30 seconds to generate a report. Try again — this is an IBKR-side delay.

**Trades appear as "orphan" in Daily View**
The query window does not include the original opening trade. Extend your Flex Query to cover a longer period or rebuild the query to include the full history.

**`/api/sync` returns 404 locally**
You are running `npm start` instead of `vercel dev`. The `/api/` serverless function only runs under the Vercel runtime.

**Logical trades double after re-sync**
The sync step deletes all `logical_trades` for the user before reinserting. If you see duplicates, check Supabase RLS policies — they may be blocking the delete.

---

## Known gaps

- **PlanSheet always sets `asset_category: 'STK'`** — options and FX plans cannot be created through the UI.
- **Settings Display / Notifications / Data sections are "Coming soon"** — no implementation exists.

### Resolved (kept for context)

- ~~Daily notes are local state only~~ — now persisted via the `daily_notes` table (DailyViewScreen upserts on save).
- ~~Sidebar win rate / "this month" stats are hardcoded~~ — see Sidebar implementation; no longer hardcoded placeholders.
- ~~No automated/scheduled sync~~ — `api/cron-sync.js` runs nightly via Vercel's cron scheduler. The IBKRScreen Auto-sync toggle controls per-user opt-in.
- ~~No `/reset-password` route in the SPA~~ — route exists at the top of `App.jsx`; component is `src/screens/ResetPasswordScreen.jsx`. Recovery email lands on it, user sets a new password via `supabase.auth.updateUser({ password })`.
- ~~No RLS documented~~ — Row Level Security policies live in `supabase/migrations/` (baseline + dated migrations). Service-role-only tables enforced; user-scoped tables use `auth.uid() = user_id` policies; sensitive columns (`ibkr_token`, `query_id_30d`) are revoked from browser SELECT entirely.

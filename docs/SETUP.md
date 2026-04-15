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
├── api/
│   └── sync.js              # Vercel serverless function: IBKR XML fetch + parse
├── public/
│   └── index.html           # HTML shell, loads DM Sans font
├── src/
│   ├── index.js             # React entry point
│   ├── index.css            # Global styles (slide-up, slide-right, toggle, overlay)
│   ├── App.jsx              # Root: auth gate + tab router + global sheet state
│   ├── components/
│   │   ├── AuthScreen.jsx   # Login / signup / password-reset form
│   │   ├── Header.jsx       # Sticky desktop nav bar
│   │   ├── MobileNav.jsx    # Fixed bottom nav (mobile only)
│   │   ├── Sidebar.jsx      # Slide-right profile + IBKR status panel
│   │   ├── PlanSheet.jsx    # Slide-up modal: create a new trade plan
│   │   └── ReviewSheet.jsx  # Slide-up wizard: resolve unmatched/ambiguous trades
│   ├── screens/
│   │   ├── HomeScreen.jsx       # Dashboard: stats cards, open positions, active plans
│   │   ├── PlansScreen.jsx      # All planned trades list with R:R calculations
│   │   ├── DailyViewScreen.jsx  # Day-grouped trade table with exec drill-down
│   │   ├── JournalScreen.jsx    # Filterable trade journal with R-multiple
│   │   ├── PerformanceScreen.jsx # KPIs, cumulative P&L chart, by-symbol/direction/asset
│   │   ├── IBKRScreen.jsx       # IBKR credentials + manual sync trigger
│   │   └── SettingsScreen.jsx   # Account info, base currency, coming-soon features
│   └── lib/
│       ├── supabaseClient.js      # Supabase client singleton
│       ├── logicalTradeBuilder.js # FIFO trade grouping: raw executions → logical trades
│       └── planMatcher.js         # Match logical trades to plans (symbol + direction + asset)
├── package.json
├── tailwind.config.js
├── postcss.config.js
├── vercel.json              # Vercel build config (CRA, output: build/)
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
REACT_APP_SUPABASE_URL=https://xxxxxxxxxxxxxxxxxxxx.supabase.co
REACT_APP_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
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

Click **Sync now** on the IBKR screen. The app calls `/api/sync`, which fetches XML from IBKR, parses it, upserts trades and open positions to Supabase, rebuilds logical trades via FIFO, and runs the plan matcher.

---

## Development workflow

### Run the frontend only

```bash
npm start          # Starts CRA dev server on port 3000
```

### Test the sync API locally

Install Vercel CLI and run:

```bash
npm install -g vercel
vercel dev         # Runs both the React frontend AND /api/sync on port 3000
```

### Build for production

```bash
npm run build      # Outputs to build/
```

### Lint (CRA built-in ESLint)

```bash
npm test           # Also runs ESLint as part of CRA test runner
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
  "outputDirectory": "build",
  "framework": "create-react-app"
}
```

Vercel automatically picks up `/api/sync.js` as a serverless function.

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
| `REACT_APP_SUPABASE_URL` | Your Supabase project URL |
| `REACT_APP_SUPABASE_ANON_KEY` | Your Supabase anon key |

See `docs/deployment.md` for full details.

---

## Troubleshooting

**"Supabase env vars not set. Auth will not function."**
You have not created the `.env` file or the variable names are incorrect. They must be `REACT_APP_SUPABASE_URL` and `REACT_APP_SUPABASE_ANON_KEY`.

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

- **No automated/scheduled sync** — the "Auto-sync: Daily after US market close" toggle in IBKRScreen is visual-only; no cron job exists yet.
- **Daily notes are local state only** — notes entered in DailyViewScreen are not persisted to Supabase; they reset on page reload.
- **Sidebar win rate and "this month" stats are hardcoded `--`** — the Sidebar does not fetch real data for those fields.
- **PlanSheet always sets `asset_category: 'STK'`** — options and FX plans cannot be created through the UI.
- **No trade detail / edit screen** — clicking a journal row does nothing.
- **Settings Display / Notifications / Data sections are "Coming soon"** — no implementation exists.
- **Password reset redirectTo URL** — `AuthScreen` uses `window.location.origin + '/reset-password'`, but there is no `/reset-password` route in the SPA. This requires a Supabase email template with a deep-link or additional routing logic.
- **No Row Level Security (RLS) documented** — Supabase RLS policies are required for security but are not tracked in the repo.

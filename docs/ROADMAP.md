# Post-launch roadmap

Features explicitly deferred until **after beta + after actual public launch**.
Nothing in here is a pre-beta or launch-week item. If something becomes urgent,
move it to `docs/BACKLOG.md` with a justification.

For known bugs and small infra fixes, see `docs/BACKLOG.md`.
For the pre-beta scale audit, see `docs/LIMITS-AUDIT.md`.
For the code-quality audit findings, see `docs/CODE-AUDIT.md`.

---

## Chart wiring inside the trade detail drawer

**Why:** Users review a closed trade and want to see the price action — not
just the numbers. An OHLC chart with their entry, exit, planned target, and
planned stop overlaid tells the "what actually happened" story at a glance.

**Prototype:** `public/chart-preview/index.html` — live at
`https://ct3000-react.vercel.app/chart-preview/`. Uses TradingView
Lightweight Charts on fake data. Shows the design intent.

**What to build:**

- Install `lightweight-charts` npm package (today it's CDN-loaded in the
  prototype).
- New `TradeChartPanel` component rendered inside `TradeInlineDetail`.
  Opt-in toggle so the expanded drawer doesn't load a chart for every
  row unless the user asks.
- Fetch OHLC data from a free-tier provider. Alpaca's free tier is the
  likely choice (IEX-only, but fine for post-hoc review).
- Overlay markers:
  - Entry fill(s) (arrow up/down, colored by direction)
  - Exit fill(s)
  - Planned target (horizontal dashed line)
  - Planned stop (horizontal dashed line)
  - Hold-window shading (between first fill and last fill)
- CT3000 watermark baked into the chart for screenshots.
- Screenshot export → save to Supabase Storage (new bucket, e.g.
  `trade-screenshots`). The user gets a shareable image with the trade
  data + watermark.

**Scope estimate:**
- Chart + markers only (no screenshots): 1–2 days
- Full (screenshots + annotation overlay): 3–5 days

**Dependencies:**
- Alpaca API key (or equivalent) in Vercel env vars
- Supabase Storage bucket + RLS policy for the screenshot feature
- Decide whether screenshots are free for all tiers or gated

**Open questions:**
- Which timeframe defaults — 5m bars, 15m, hourly? Probably auto-select
  based on the trade's hold duration.
- How to handle trades on instruments Alpaca doesn't cover (options,
  non-US equities). Fall back to a "no chart available" state.
- Do we render the chart for open positions too, or only closed trades?

---

## Missed Trades — end-to-end UX

**Why:** Users spot setups they don't take. Logging those — with the
plan/playbook they had in mind — lets us later answer "are you missing
winners, or dodging losers?"

**What exists today:**
- Schema: `missed_trades` table (`noted_entry_price`, `noted_at`,
  `thesis`, `playbook_id`, ...).
- A "Missed" tab on the Smart Journal that's currently a
  "coming next" placeholder.
- Playbook tagging already works on plans — same `playbook_id` FK
  concept will extend naturally.

**What to build:**
- `MissedTradeSheet` modal — entry/exit-like fields but framed as
  "what I was thinking if I had taken this."
- Home quick-action: a "Log a missed trade" button for fast capture.
- List view replacing the placeholder on the Smart Journal Missed tab.
- Optional: live "what would it have done" calc using current price.

**Scope estimate:** ~1 day for a first pass.

**Deferred to:** planning session with full Playbooks + Relevant Trades
context (see below) — the three features overlap and should be designed
together.

---

## Playbooks — beyond CRUD

**Why:** A playbook is supposed to be a reusable setup you track over
time ("MA30 Retracement Long"). Right now it's just a CRUD screen —
you can create/edit/delete playbooks, but there's no insight layer yet.

**What exists today:**
- `playbooks` table + `planned_trades.playbook_id` FK.
- Playbooks section in the Smart Journal (list + CRUD via `PlaybookSheet`).

**What to build:**
- Per-playbook stats page: # of trades tagged, win rate, avg P&L,
  expectancy, avg adherence, best/worst trade.
- Missed-vs-taken comparison per playbook: "you took 40% of the setups
  you saw for this playbook. Of the 60% you missed, X% would have won."
- Playbook performance over time (rolling win rate, expectancy curve).
- Possibly: playbook tags on trades (right now the link is trade →
  plan → playbook, indirect).

**Deferred to:** planning session.

---

## Relevant Trades

**Scope TBD** — user flagged this for later planning alongside Missed
Trades + Playbooks. Likely candidates for what this means:

- Showing historical trades on the same ticker when creating a new plan
  (partially exists in `PlanSheet` historical trades list).
- "Related trades" section on the inline trade detail (same ticker,
  same playbook, or same direction).
- Cross-referencing: "you made this trade, and here are 3 prior trades
  on the same setup — how did those go?"

User to clarify scope at planning time.

---

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

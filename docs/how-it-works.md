# How CT3000 works

*A plain-English tour for the product owner.*

---

## The short version

CT3000 is a trading journal for traders who use Interactive Brokers. It pulls
your trade history from IBKR automatically, lets you write plans before trades
and review them after, and shows you patterns you wouldn't see looking at raw
trades one by one.

Everything the user sees lives in their web browser as a React app. Everything
that needs to stay secret or expensive (database, trading data, billing)
happens on servers they never touch. Those two worlds talk to each other over
the internet in narrowly defined ways, which is where a lot of the design
energy goes.

---

## The cast of characters

Four pieces of software, each owned by someone else, work together to make the
app run:

**1. Your browser (the React app)**
This is the part you see — the dashboard, the buttons, the heatmap, the stat
tiles. It's a JavaScript program delivered as a web page. It runs on your
Mac, in Chrome or Safari. It has no secrets, holds no permanent data, and
can only do anything by asking one of the other three characters for help.

**2. Vercel**
A hosting company. They do two jobs for us. First, they serve the React app
to anyone who visits `cotraderapp.com`. Second, they run our "serverless
functions" — small bits of code that execute when someone asks (for example:
"sync my IBKR trades" triggers a function on Vercel that actually goes and
does it). We don't own any servers ourselves; we pay Vercel a small amount
per function call.

**3. Supabase**
The database and login system. All the trades, plans, notes, and user
accounts live here. Supabase also handles "is this person logged in?" so
we don't have to build that from scratch. It has two modes: a safe mode
(the browser can read only your own rows — enforced by "Row-Level Security")
and an admin mode (only the server can use it — can read and write anyone's
data). Mixing those up is one of the biggest foot-guns in the codebase, so
the audit keeps checking we haven't.

**4. Interactive Brokers (IBKR)**
Not ours, not a partner — just an external service the user has an account
with. We talk to their "Flex Query" system, which is an XML feed of every
trade the user has made. The user generates a token from IBKR's portal,
pastes it into our app, and from then on we can pull their trade history
on demand.

**5. Stripe**
Billing. Anyone who signs up goes through a 7-day free trial and then
pays $30/month. Stripe handles the card details, the recurring billing,
the invoicing, the customer portal where users manage their subscriptions.
We never store a card number — Stripe does. We just record "yes, this
user's subscription is active."

That's it. There's no other party in the loop.

---

## What happens when a new user signs up

Five steps, each involves a different character:

1. **The user lands on the welcome page.** This is the React app, served
   by Vercel. They click "Start free trial" and get sent to a signup form.

2. **They pick an email and password.** The form calls Supabase's built-in
   auth (`supabase.auth.signUp`). Supabase creates a user record and returns
   a session. Done in a blink.

3. **They land in the Stripe Checkout flow.** Behind the scenes, our
   serverless function `api/create-checkout-session` creates a Stripe
   "customer" and a "checkout session," then Stripe redirects the user to
   Stripe's own payment page. The user enters their card, starts their
   trial, and gets sent back to `cotraderapp.com`.

4. **Our app polls for the trial to go active.** Stripe sends us a webhook
   (a back-channel "hey, this user is now trialing!" message) at
   `/api/stripe-webhook`, which flips their `subscription_status` to
   `trialing` in our database. The React app, meanwhile, is polling every
   two seconds looking for that flip. Usually it takes under 10 seconds.

5. **They land on the dashboard for the first time.** Because they haven't
   connected IBKR yet, we auto-seed some demo data (fake trades, fake
   plans) so the app isn't empty. A blue banner at the top says "This is
   demo data — connect your IBKR account to see your real trades." The
   moment they connect IBKR, we wipe the demo data and replace it with
   their real history.

---

## How real trade data gets in

This is the most interesting flow in the whole app. Four handoffs:

**Step 1 — The user enters IBKR credentials.**
They go to the IBKR screen in our app, paste their Flex Query token and
Query ID (two strings from IBKR's portal), and hit Save. The browser
sends those to our `api/ibkr-credentials` endpoint, which validates,
stores a masked display version ("••••1234"), and writes the raw
secrets to the database from the server. The browser is not allowed to
write the raw token — database grants explicitly forbid it.

**Step 2 — They hit Sync Now.**
The browser POSTs to `api/sync` with the user's session token. The
server checks the token, checks the user's subscription is active or
trialing, then calls IBKR's Flex web service with the saved token,
parses the XML (every fill in the last 30 days), and writes everything
to the database server-side: raw fills into the `trades` table, current
positions into `open_positions`, last-sync timestamp onto the
credentials row. The browser doesn't touch any of those tables itself
during a sync; it just gets back a summary ("3 new fills, 49 total in
window") and renders it.

**Step 3 — Raw trades become "logical trades."**
A single trade in trader-language ("I bought NVDA, then sold it three
days later") is often *multiple* rows in IBKR's data (one for each
partial fill, one for the exit, etc.). So we have a second table,
`logical_trades`, which groups those raw rows into round-trip stories
using FIFO (First In First Out) matching. This happens server-side as
the last step of the same Sync — there's no separate "rebuild" call
the browser has to make. The `logical_trades` table is what every
screen in the app actually reads. (There is also a standalone
`api/rebuild` endpoint for re-running just the FIFO step without a
fresh IBKR pull.)

**Step 4 — Plans get matched to trades.**
If the user wrote a plan for NVDA *before* they took the trade, and the
symbol/direction/asset class match up, the rebuild step links the two.
Matched closed trades also get an "adherence score" (0–100) measuring
how closely the actual execution followed the plan — entry slippage,
stop respect, target hit, size deviation, averaged into one number.
This is computed inside the same rebuild pass; nothing for the user to
trigger manually.

The net result: one Sync button, and a few seconds later the whole app
is populated with your real trading history, properly organised,
matched against your plans, scored for discipline.

---

## The screens (in the order a trader uses them)

The app has eight main screens. The sidebar on mobile, or the top nav on
desktop, moves you between them. Each has a dedicated purpose; none try
to do what another one does.

**Home (the dashboard).**
The first thing you see. Today's P&L. Open positions. Active plans
(ones you've written but haven't traded yet). A "trade review pipeline"
card showing how many closed trades still need you to review them.
This screen is the "status check" — glance at it each morning.

**Plans.**
Where you write trade plans *before* taking them. Ticker, direction,
entry, stop, target, quantity, strategy, thesis. Short and structured
— the whole point is to force yourself to think through a trade before
clicking buy. Each plan lives in the `planned_trades` table.

**Daily view.**
A day-by-day breakdown of every trade. Read like a diary. You can
write notes for each day (captured in `daily_notes`). Useful for "what
happened on Tuesday" reviews.

**Journal.**
The list of every closed trade. Filter by wins, losses, plan status.
Click a row to expand and see the detail — entry, exit, duration,
adherence score, review notes. This is where you categorise each
trade ("this was planned," "this was off-plan," "this needs more
thought") and write what you learned.

**Performance.**
Stats, charts, and automated insights. Cumulative P&L curve, win rate,
expectancy, win/loss ratio. Twelve deterministic "callouts" that fire
when the data shows something notable ("you have a losing record on
Fridays," "3 revenge trades in an hour," "your biggest drag is CRWV").
Each callout expands to explain why it fired and what to try doing
about it.

**Review.**
A triage queue for trades that couldn't be auto-matched to a plan.
If you wrote two plans for NVDA and bought NVDA, the system can't tell
which plan you intended — so it puts the trade here and asks you to
choose. Walking through this queue keeps your stats accurate.

**IBKR.**
Connection management. Where you save/update your Flex token, hit
Sync Now, run Rebuild manually if you need to, or disconnect entirely.
Shows your last sync timestamp and any errors from the last run.

**Settings.**
Account info (email, IBKR account ID, base currency), link to the Stripe
customer portal, support email, app version, and the big red Delete
Account button (guarded by a two-step flow: cancel Stripe first, then
confirm with a typed "DELETE").

**Coming but not live: TradeSquares.** A GitHub-style heatmap of your
discipline (365 days, one square per day, green/yellow/red based on
adherence). Built and sitting on a branch, ready to launch when you're
ready.

---

## What happens when data changes

A subtlety worth understanding: each of those screens is basically a
window onto the same underlying database, but none of them knows when
another screen changes something. If you're on Journal and you resolve
a "needs review" trade, the Home dashboard — which was counting that
trade in its "Need matching" pipeline — needs to find out.

We solve that with something called the **DataVersionContext**. It's a
little invisible counter that ticks up every time some data changes.
Each screen says "I care about changes to `trades` and `plans`" when
it loads, and the counter triggers a silent refresh. No spinner, no
jolt — the old data stays visible until the new data is ready, then
they swap.

Combined with "keep-alive navigation" (screens stay loaded in memory
when you tab away, so coming back is instant), this makes the app
feel faster than it technically is. You're never waiting on the same
fetch twice.

---

## What happens when things go wrong

Three safety nets:

**Sentry** — every error, anywhere in the app, gets reported to an
observability service called Sentry. We tag each error with the screen,
the user, the action. When a beta user reports "it crashed when I
clicked save," we can usually find the exact error in Sentry within
seconds.

**LoadError UI** — every screen that loads data from Supabase uses the
same pattern: a spinner while loading, a retry button if the load
failed. No screen ever silently stays blank — it either shows data or
shows "Couldn't load, try again."

**ErrorBoundary** — if a React component crashes in a way we didn't
anticipate, a top-level wrapper catches it and shows "Something went
wrong, please refresh" instead of a blank white page. Not elegant, but
the user at least understands what happened.

---

## What's real vs what's planned

**Real and shipping today:**
Sign-up, Stripe billing, IBKR connection, Sync, Rebuild, all 8 screens,
Performance insights, data invalidation, support email surfaces, Stripe
customer portal, account deletion with feedback.

**Built but not yet launched:**
TradeSquares (on the `tradesquares` branch — one migration away from
going live).

**Designed but not built:**
Missed trades (table exists in the DB schema, no UI yet). Trade
management / ongoing-plan tracking (the "water the plants" feature from
the voice memo — shelved for now). Transactional emails (welcome,
trial-expiring, etc. — Stripe and Supabase cover the essentials; we
don't send any of our own yet).

**Open before public launch:**
Terms of service, privacy policy, FAQ, proper support ticket system
on `support@cotraderapp.com` (currently everything points at
`thinker@philoinvestor.com` as the interim email).

---

## The TL;DR mental model

If someone asks you in a hallway, it goes like this:

- **The app** is a website built in React, hosted by Vercel.
- **The data** lives in Supabase, with strict per-user walls.
- **The trades** come from IBKR via an XML feed the user authorises.
- **The money** goes through Stripe.
- **The logic** for turning trades into insights runs on Vercel's
  serverless functions — mostly `api/sync.js` (pull from IBKR) and
  `api/rebuild.js` (process into trades/adherence scores).
- **The screens** read from the database; they don't do any trading
  logic themselves.

Everything else — the streaks, the insights, the heatmap, the plan
matcher — is just different ways of presenting the same set of
tables.

That's the whole app.

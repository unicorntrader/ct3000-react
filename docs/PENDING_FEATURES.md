# Pending features

Features whose schema is in place but the surrounding code (writer, reader,
or UI) hasn't shipped yet. Compiled during the 2026-04-27 schema-vs-code
audit so future devs (and audits) don't flag these as dead code.

When a feature here ships, remove its entry. When a feature here is
abandoned, drop the schema and remove the entry.

---

## `ghost_webhook_events` table

**Status:** schema only. Zero code references.

**Intended use:** admin-side review queue for inbound Ghost webhook events.
Instead of the webhook auto-applying member status changes (current
behavior in `api/ghost-webhook.js`), it would write each event to this
table with `proposed_action` + `status='pending'`. An admin then reviews
each row in the admin app and approves / rejects, only then mutating
`user_subscriptions`.

**Schema columns describe the design:**
- `proposed_action` (text, NOT NULL) — what the webhook wanted to do
- `status` (default `'pending'`) — pending / approved / rejected
- `reviewed_by`, `reviewed_at` — admin audit
- `raw_payload` (jsonb) — full webhook body for forensics

**To ship:** wire `api/ghost-webhook.js` to insert here instead of mutating
directly; build a review queue screen in ct3000-admin that lists pending
events and applies them on approval.

---

## `invited_users.trial_months` column

**Status:** column present, never written or read.

**Intended use:** companion to `is_comped`. When set, the invite grants
the recipient N months of paid-equivalent access instead of the
forever-comp default. Time-boxed comp invites for press/affiliates/etc.

**To ship:**
- ct3000-admin's invite form would add a "Duration: forever / 1 / 3 / 6 / 12 months" select. Forever leaves `trial_months` null; finite sets the value.
- `ct3000-react/api/redeem-invite.js` reads `trial_months`; if null, uses the existing forever-comp shape; if set, computes `current_period_ends_at = now + N months` and leaves `is_comped=false` (or sets to true with bounded date — design call).

---

## TradeSquares (lives on `tradesquares` branch)

**Status:** fully built on the `tradesquares` branch, on ice for launch
timing.

**What's there:** GitHub-style discipline heatmap on the Dashboard
(365 days, one square per day, color-coded by daily adherence) +
journal-dot overlays + activity tiles + demo mode. Reads from the
`daily_adherence` table.

**To ship:** merge `tradesquares` into main when ready to launch. The
data layer (`daily_adherence`) was decoupled from TradeSquares on
2026-04-27 — the rollup now populates on every rebuild/sync regardless
of whether the heatmap UI is visible.

---

## Audited and confirmed alive (not pending)

For reference — the 2026-04-27 audit re-verified these tables/columns
are actively used and should NOT be dropped:

- `daily_adherence` — populated by `recomputeDailyAdherence.js` on every
  rebuild/sync; consumed by PerformanceScreen (and TradeSquares when it
  launches)
- `securities` — used by PlanSheet ticker autocomplete
- `weekly_reviews` — used by PerformanceScreen
- `account_deletions` — used by delete-account flow + cron-anonymize-churn
- `processed_stripe_events` — used by stripe-webhook idempotency
- All `user_ibkr_credentials` columns including masked variants — used by
  IBKRScreen + Sidebar + sync flows

# Backend — server endpoints

CT3000 runs on Vercel serverless functions under `/api/`. The browser
talks to these via Bearer-Supabase-JWT-authenticated POST/DELETE
requests; persistence and IBKR access live exclusively in the server
process. There is no browser-side write to the trading-data tables on
the modern code path.

This document covers the most commonly-touched endpoints. For a flat
list of every endpoint see the table in `README.md`.

---

## `/api/sync` — server-authoritative IBKR sync

**File:** `api/sync.js`. Delegates to `api/_lib/performUserSync.js`.

The full IBKR pull-and-persist flow runs server-side. The browser sends
a JWT, gets a summary back, and updates UI state. It does not touch
`trades` / `open_positions` / `logical_trades` directly during a sync
anymore.

### Request

```
POST /api/sync
Authorization: Bearer <Supabase-JWT>
Content-Type: application/json
```

Body is normally empty. Two paths:

- **Normal sync (empty body)** — server reads the user's saved IBKR
  credentials from `user_ibkr_credentials` via `service_role`, fetches
  Flex XML, parses, and persists.
- **Test mode (`{ token, queryId }` in body)** — used during initial
  IBKR-connect on `IBKRScreen` before credentials are saved. Verifies
  the credentials end-to-end and returns counts; does NOT persist
  anything.

### Auth + paywall

Two gates before any IBKR call:

1. `supabaseAdmin.auth.getUser(jwt)` validates the bearer token.
   Failure → 401.
2. `requireActiveSubscription(user.id, supabaseAdmin)` checks the
   user's `user_subscriptions` row. Returns OK for `is_comped=true`,
   `subscription_status='active'`, or `'trialing'` whose `trial_ends_at`
   / `current_period_ends_at` is in the future. Otherwise → **402** with
   a user-facing reason. Mirrors `isActive()` in `src/App.jsx`.

Source: `api/_lib/requireActiveSubscription.js`.

### Persistence flow (normal sync)

1. Read IBKR token + queryId from `user_ibkr_credentials`. Both required.
2. `sendRequest(token, queryId)` → IBKR returns a `<ReferenceCode>`.
3. `getStatement(refCode, token)` polls IBKR (10× × 3s) until the
   report is ready or the IBKR Flex `Status` is non-`Warn` terminal.
4. Validate the Flex Query period. Reject if it covers > 35 days.
5. Parse `<Trade>` and `<OpenPosition>` elements; extract
   `baseCurrency` from `<AccountInformation>`.
6. **Diff incoming `ib_exec_id`s against existing rows** so the response
   can report new-vs-already-known trades.
7. Upsert `trades` (conflict on `user_id, ib_exec_id`).
8. Replace `open_positions` (delete-then-insert pattern, scoped by
   `user_id`).
9. Clear demo rows on `logical_trades`, `open_positions`,
   `planned_trades`, `playbooks`.
10. Update `user_subscriptions.ibkr_connected = true`.
11. Update `user_ibkr_credentials` — `last_sync_at`, `account_id`,
    `base_currency`, clear `last_sync_error` / `last_sync_failed_at`.
12. Call `rebuildForUser(userId, supabaseAdmin)` to regenerate
    `logical_trades` from raw trades.

On error after step 6, `last_sync_error` and `last_sync_failed_at`
get written to the credentials row so the UI can surface the failure.

### Successful response

```json
{
  "success": true,
  "mode": "sync",
  "tradeCount": 49,
  "openPositionCount": 14,
  "logicalCount": 16,
  "rebuildWarnings": [],
  "newTradeCount": 3,
  "newTradesPreview": [
    { "symbol": "NBIS", "buySell": "BUY", "quantity": 30,
      "price": 148.29, "currency": "USD",
      "dateTime": "2026-04-25T17:36:00.000Z" }
  ]
}
```

Note: `dateTime` is real UTC (post the 2026-04-25 timezone fix). The
browser renders in user-local TZ via `toLocaleString`.

### Test-mode response (when `body.token + body.queryId` provided)

```json
{
  "success": true,
  "mode": "test",
  "tradeCount": 49,
  "openPositionCount": 14,
  "baseCurrency": "USD"
}
```

No DB writes occurred.

### Error responses

| Scenario | Code | Notes |
|---|---|---|
| Missing/invalid Authorization | 401 | |
| Inactive subscription | 402 | `error` field carries human reason |
| Flex Query period > 35 days | 400 | `flexPeriodDays` echoed back |
| Could not parse Flex period | 400 | |
| IBKR rejected request / timeout | 500 | `error` carries IBKR message |
| Any other server error | 500 | `last_sync_error` written to creds |

### Trade timezone parsing

IBKR Flex `dateTime` values arrive as exchange-local wall-clock time
(no timezone annotation). `api/_lib/exchangeTimezone.js` maps each
known venue (NASDAQ, NYSE, DARK, IBKRATS, LSE, IDEALFX, …) to an IANA
timezone; `ibkrDateToUtcIso(dateTime, exchange)` converts to true UTC
before storing.

The `trades.exchange` and `trades.order_type` columns are persisted
alongside the timestamp, so future rebuilds / display layers can use
exchange-precise tz lookups instead of bucketing by asset class.

### Browser handler

`src/screens/IBKRScreen.jsx::handleSync` is now ~40 lines:

```
POST /api/sync (with JWT)
  ↓
parse summary response
  ↓
update local lastSyncAt + bump('trades','positions','ibkrCreds')
  ↓
render newTradesPreview list and totals footer
```

No client-side DB writes during sync.

---

## `/api/rebuild`

**File:** `api/rebuild.js`. Delegates to `api/_lib/rebuildForUser.js`.

Same auth + subscription pattern as sync. Calls `rebuildForUser` to:

1. Fetch all `trades` for the user (full history, not windowed).
2. Read existing `logical_trades` to preserve user-reviewed decisions
   across rebuilds (`opening_ib_order_id` is the join key).
3. Call `buildLogicalTrades(rawTrades, userId)` (FIFO matcher in
   `api/_lib/logicalTradeBuilder.js`).
4. Apply plan matching against `planned_trades`; compute adherence
   scores via `api/_lib/adherenceScore.js`.
5. Backfill `planned_trades.currency` where the plan didn't set one.
6. Replace the user's `logical_trades` rows.

Returns `{ success: true, count, warnings }`.

`/api/sync` calls `rebuildForUser` directly (in-process), so the HTTP
endpoint is mainly used for "rebuild without a fresh IBKR pull"
scenarios.

---

## `/api/ibkr-credentials` — IBKR token write/delete

**File:** `api/ibkr-credentials.js`. Added 2026-04-25 to close the
last browser-write surface on `user_ibkr_credentials`.

### POST

```
POST /api/ibkr-credentials
Authorization: Bearer <Supabase-JWT>
Content-Type: application/json

{ "token": "...", "queryId": "..." }
```

- Validates token length 8–256, queryId length 1–16.
- Computes masked variants (`token_masked`, `query_id_masked`).
- Upserts `user_ibkr_credentials` via `service_role` (conflict on
  `user_id`).
- Returns `{ success: true, tokenMasked, queryIdMasked }`.

### DELETE

```
DELETE /api/ibkr-credentials
Authorization: Bearer <Supabase-JWT>
```

Removes the user's credentials row. Returns `{ success: true }`.

### Why server-only

The DB grants on `user_ibkr_credentials` were tightened to deny
INSERT / UPDATE / DELETE for `anon` and `authenticated`, with one
narrow exception: column-level UPDATE on `auto_sync_enabled` (the
toggle on the IBKR screen). All other writes must go through this
endpoint, which uses `service_role`.

Source migrations:
- `supabase/migrations/20260425_ibkr_credentials_safe_column_grant.sql`
  — deny-by-default SELECT, allow only safe columns (masked +
  metadata).
- `supabase/migrations/20260425_ibkr_credentials_revoke_writes.sql` —
  revoke INSERT/UPDATE/DELETE; column-grant UPDATE on `auto_sync_enabled`.

---

## Shared helpers (`api/_lib/`)

| File | Purpose |
|---|---|
| `supabaseAdmin.js` | `service_role` client factory |
| `stripe.js` | Stripe SDK wrapper |
| `sentry.js` | `captureServerError` helper |
| `requireActiveSubscription.js` | Subscription gate, mirrors `isActive()` |
| `performUserSync.js` | End-to-end sync flow used by `/api/sync` and `/api/cron-sync` |
| `rebuildForUser.js` | FIFO + plan-matching rebuild used by `/api/rebuild`, `performUserSync`, and `/api/cron-sync` |
| `logicalTradeBuilder.js` | Pure FIFO logic; no DB calls |
| `adherenceScore.js` | Plan vs. fills scoring (0–100) |
| `exchangeTimezone.js` | IBKR venue → IANA tz map + `ibkrDateToUtcIso` |

The `_` prefix excludes them from Vercel's serverless-function count.

---

## Cron functions

| Endpoint | Schedule | Purpose |
|---|---|---|
| `/api/cron-sync` | nightly (per `vercel.json`) | Loops every user with auto-sync enabled and an active subscription, runs `performUserSync`. CRON_SECRET auth. |
| `/api/cron-anonymize-churn` | weekly | Strips `email` + `stripe_customer_id` from `account_deletions` rows older than 90 days. Idempotent. |

Both auth via `Authorization: Bearer ${CRON_SECRET}` header (set on the
Vercel project + sent automatically by Vercel's cron scheduler).

---

## IBKR Flex Query requirements

The Flex Query configured in IBKR must include the **Trades** section
with these fields, at minimum:

`ibExecID`, `ibOrderID`, `accountId`, `conid`, `symbol`, `assetCategory`,
`buySell`, `openCloseIndicator`, `quantity`, `tradePrice`, `dateTime`,
`netCash`, `fifoPnlRealized`, `ibCommission`, `ibCommissionCurrency`,
`currency`, `fxRateToBase`, `transactionType`, `notes`, `multiplier`,
`strike`, `expiry`, `putCall`, `exchange`, `orderType`.

The **Open Positions** section must include:

`accountId`, `conid`, `symbol`, `assetCategory`, `position`, `avgCost`,
`marketValue`, `unrealizedPnl`, `currency`.

The `<AccountInformation>` element should carry the `currency`
attribute (used for the user's account base currency).

The query period must be ≤ 35 calendar days. The shipping config is
"Last 30 Calendar Days".

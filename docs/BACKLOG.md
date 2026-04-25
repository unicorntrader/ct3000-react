# Backlog — small things to fix later

Running list of known, low-priority, or deferred improvements. When a beta
bug gets reported, check here first — the cause might already be on the
list.

## IBKR XML parser (`api/sync.js`, `api/lib/logicalTradeBuilder.js`)

- **Self-closing tag assumption.** `/<Trade\s([^>]+)\/>/g` only matches
  `<Trade ... />`. If IBKR ever emits `<Trade ...></Trade>` (some report
  configs do), parsing returns zero trades silently. Fix: broaden the
  regex or move to a real XML parser.

- **Empty numeric → null coercion.** `get('field')` returns `""` when an
  attribute is present but empty. Postgres rejects `""` on numeric
  columns. Add a helper that returns `null` for empty strings before
  insert. Not biting today — every current row has values — but one
  future weird IBKR row breaks sync.

- **HTML entity decoding.** Raw values come back with `&amp;`, `&quot;`,
  `&lt;`, etc. verbatim. A description like `"Apple & Co"` lands in the
  DB as `"Apple &amp; Co"`. Low priority; IBKR rarely uses these in
  fields we care about.

- **Quote inside attribute value.** `"([^"]*)"` stops at the first inner
  quote. If IBKR ever embeds an unescaped `"` inside a value, the field
  gets mangled. Theoretical.

- **Truncated-response detection.** `httpsGet` resolves on `on('end')`
  even if the server closed the connection mid-stream. Parsers then see
  incomplete XML and return partial results — silent data loss. Fix:
  verify the closing tag `</FlexQueryResponse>` is present, or check
  content-length vs received bytes.

- **UTF-8 broken at chunk boundaries.** Node's http `on('data')` emits
  Buffer chunks; the current `data += chunk` stringifies each chunk
  independently, which can split a multi-byte UTF-8 character in half.
  Fix: accumulate as `Buffer[]`, `Buffer.concat()`, then `.toString('utf8')`.

- **Token in URL query string.** IBKR auth token is sent as `?t=TOKEN`.
  Tokens end up in proxy/access logs. Check if IBKR accepts the same
  creds via POST body. If not, accept as IBKR design.

- **Weak `RefCode` validation.** Currently we only verify digits are
  present. Also confirm `<Status>Success</Status>` before trusting the
  response, so an IBKR error payload with numeric fields doesn't get
  mistaken for a valid reference.

- **Fixed retry backoff.** 10 retries, 3s each = 30s ceiling on
  `getStatement`. Large statements take longer; user sees "timed out"
  when another 20s would have worked. Switch to exponential backoff.

- **Whole XML held in memory.** Concatenating all chunks into a single
  string peaks memory at the full response size. Fine for retail (a few
  hundred trades ≈ low hundreds of KB); flag for larger users. Fix:
  streaming parser.

## Schema / data

- **`trades.date_time` still `varchar(20)` in IBKR compact format**
  (`YYYYMMDD;HHMMSS`). Sibling columns on `logical_trades` already moved
  to `timestamptz` on 2026-04-17. Coordinated code + migration ship
  required: update `api/sync.js` to parse at sync time and the `toMs`
  helpers in both `logicalTradeBuilder` copies, then run the ALTER.

- **Two copies of `logicalTradeBuilder` and `adherenceScore`** in
  `src/lib/` (ES module) and `api/lib/` (CJS). Drift-prone — fixes must
  land in both. Consolidation candidate.

- **`planned_trades.playbook_id` and `missed_trades.playbook_id` aren't
  wired into the UI yet.** Schema is there with FKs, but nothing sets
  these. Playbook CRUD ships in Smart Journal; next step is to add
  dropdowns in `PlanSheet` and the forthcoming `MissedTradeSheet`.

## UI / UX

- **P&L conversion inconsistent across screens.** `HomeScreen` and
  `ReviewSheet` use raw `total_realized_pnl`; `Journal` and `Performance`
  use `pnlBase()`. Pick one; right answer is always `pnlBase()` at the
  aggregate layer.

- **Direction case inconsistent.** `HomeScreen` lowercases (`long` /
  `short`); `Journal` shows `LONG` / `SHORT`. DB stores uppercase. Pick
  one display style.

- **Share-on-X link position still ugly in Journal row.** Comes too close
  to the status pill on narrow widths.

## Auth / ops

- **Admin panel exposes service role key to the browser.** Documented
  pattern, but means anyone with browser access to the admin domain can
  do anything. If admin usage grows beyond you, move privileged ops
  behind a server-side API with per-admin auth.

- **No rate limit or circuit breaker on `/api/sync`.** If IBKR is down,
  each user sync still tries 10 retries × 3s. Fine for 10 beta users;
  revisit if sync frequency grows.

## Pre-public-launch infrastructure

- **Custom SMTP for Supabase Auth.** Currently using Supabase's built-in
  email service, which is rate-limited and not intended for production.
  Fine for invite-only BETA. Before public launch: set up Postmark or
  Resend (~$10/mo), point Supabase → Authentication → SMTP Settings at
  it. Ensures password resets, invite emails, and confirmation emails
  don't get throttled or spam-filtered.

- **90-day cleanup cron on `account_deletions`.** Privacy policy
  promises we strip email + stripe_customer_id from deletion records
  after 90 days. Currently we never do. Before public launch: add a
  scheduled job (Supabase pg_cron or a Vercel cron function) that
  UPDATEs the table to null out identifying columns on rows older
  than 90 days.

- **Legal review of `/terms` and `/privacy`.** Both pages carry a
  `NEEDS LEGAL REVIEW` header comment. Placeholder copy is fit for
  private BETA but must be reviewed by a solicitor familiar with
  Cyprus / EU consumer contract law and financial-tools liability
  before public launch.

- **Swap support email.** `src/lib/constants.js` → `SUPPORT_EMAIL`
  currently `thinker@philoinvestor.com`. Flip to
  `support@cotraderapp.com` once the mailbox + ticket service is
  wired. Single string change propagates everywhere.

## Security hardening (deferred from 2026-04-24 audit)

Items surfaced during the 2026-04-24 security audit that were
consciously benched rather than fixed. Each is low actual risk today
given the other mitigations already in place.

- **Move IBKR credentials save to a server endpoint.** Today
  `IBKRScreen.jsx:101-110` upserts the raw `ibkr_token` and
  `query_id_30d` directly from the browser via the anon client.
  The read side is already hardened (REVOKE SELECT on those columns
  for authenticated role, shipped in `20260424_revoke_ibkr_secret_columns.sql`),
  so a compromised tab can no longer exfiltrate stored tokens from
  the DB. What's still open is the save event itself: for the few
  seconds between "click Save" and "upsert completes", the raw token
  sits in browser memory. Attack requires a compromised tab *at the
  exact moment* the user is typing a fresh token — very narrow.
  Proper fix: add `POST /api/save-ibkr-credentials`, browser POSTs
  `{ token, queryId }` over HTTPS, server writes via service_role.

- **Rate-limit `/api/sync` and `/api/rebuild`.** JWT auth means a
  single user with a compromised or shared JWT can spam the endpoints.
  Each sync hits IBKR's Flex API which has per-token rate limits; a
  tight loop could get the whole app IP blocked. Simplest guard:
  server-side "last successful sync was < 60s ago → 429".

- **Teach `isActive()` about `is_comped`.** `src/App.jsx:32-42`
  gates the UI on `subscription_status` only. Today comped users get
  `subscription_status='active'` set by `redeem-invite.js`, so the
  check passes. If that setter misfires, comped users hit the
  paywall. The server-side gate (`requireActiveSubscription`) now
  honours `is_comped` — App.jsx should too, belt-and-braces.

- **Debug endpoint admin allowlist.** `api/debug-flex-xml.js:12`
  hardcodes `ALLOWED_EMAIL = 'antonis@protopapas.net'`. Fine today
  but wants to live in `app_settings.admin_emails` or an env var
  before adding more admin users.

- ~~**`fast-xml-parser` CVE (GHSA-gh4j-gqv2-49f6).**~~ Resolved: the
  package was uninstalled on 2026-04-25 — turned out it was never
  actually imported. IBKR Flex XML is parsed by hand-rolled regex
  in `api/_lib/performUserSync.js`. If we ever need a real parser
  (better entity decoding, non-self-closing tags, etc.), revisit.

- **Stale entry above:** the "90-day cleanup cron on
  `account_deletions`" item under "Pre-public-launch infrastructure"
  is done. Shipped as `api/cron-anonymize-churn.js` (commit
  `8a056efb`) plus a one-time backfill
  (`20260424_backfill_anonymize_account_deletions.sql`). Remove when
  next editing this section.

## Schema cleanup (deferred from 2026-04-25 dead-column audit)

The 2026-04-25 audit found columns and a table that are written by
the codebase but never read. As a first pass, the writes were
removed (commits 86d0... onwards). The schema still carries the dead
storage. Drop it when convenient:

- **`logical_trades.account_id`** — written by `logicalTradeBuilder`,
  never read. The same value lives on `trades.account_id` and
  `user_ibkr_credentials.account_id`. Safe to drop.
- **`logical_trades.is_reversal`** — boolean flag set on `C;O`
  reversal LTs. Never queried. Could be repurposed (UI badge "this
  was a flip") if desired; otherwise drop.
- **`logical_trades.source_notes`** — text written by the builder
  with explanations like "opened before your earliest imported
  trade". Never displayed. Could be surfaced in `TradeInlineDetail`
  if useful; otherwise drop.
- **`logical_trade_executions` (entire table)** — read by Daily View
  pre-2026-04-25, written by no code in this repo, found empty in
  prod. The DV read has been removed. Drop the table unless we plan
  to repurpose it for proper FIFO provenance / reversal-aware
  position math (would require populating it from
  `rebuildForUser`).

Migration when ready:

```sql
alter table public.logical_trades
  drop column if exists account_id,
  drop column if exists is_reversal,
  drop column if exists source_notes;

drop table if exists public.logical_trade_executions;
```

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

-- ══════════════════════════════════════════════════════════════════════
-- One-time backfill: re-interpret trades.date_time per asset class.
--
-- Background: api/sync.js historically wrote IBKR's naive "wall clock"
-- time value (e.g. "2026-04-23T16:13:43") into the timestamptz column
-- without applying the exchange's timezone. Postgres treated those as
-- UTC, so a fill that actually happened at 16:13 New York time was
-- stored as if it had happened at 16:13 UTC. Browsers in non-ET zones
-- saw the trade hours off from when it really fired.
--
-- Going forward: api/_lib/performUserSync.js + api/_lib/exchangeTimezone.js
-- convert (dateTime, exchange) to real UTC at ingest. This migration
-- catches up the historical rows.
--
-- Bucketing: trades.exchange is not stored, so we approximate by
-- asset_category. STK + OPT trades on US-listed instruments are
-- America/New_York. FXCFD + CASH (FX) is already canonical UTC -- no
-- shift. This is a 99% correct approximation; the rare LSE / non-US
-- equity row will be a few hours off until the user re-syncs (which
-- will overwrite it via upsert with the corrected value).
--
-- Idempotency: this migration is one-shot. Re-running it would shift
-- already-corrected rows again. Migration filenames already enforce
-- "run exactly once per environment", so as long as nobody manually
-- re-applies it, we're safe.
--
-- After this runs in prod, the user should hit Sync Now once -- that
-- triggers rebuildForUser, which regenerates logical_trades.opened_at
-- and closed_at from the corrected trades.date_time values. Until they
-- do, logical-trade timestamps may still display in the old shifted
-- form; raw drill-throughs in Daily View use trades.date_time directly
-- and will be correct immediately.
-- ══════════════════════════════════════════════════════════════════════

-- Shift US equities and options by interpreting the stored wall-clock
-- value as America/New_York instead of UTC. PostgreSQL idiom:
--   timestamptz -> timestamp (naive) -> AT TIME ZONE 'America/New_York'
--                                      (returns timestamptz)
update public.trades
   set date_time = (date_time::timestamp at time zone 'America/New_York')
 where asset_category in ('STK', 'OPT')
   and date_time is not null;

-- FXCFD / CASH stays as UTC. No update needed; documenting intent here.
-- (No-op SELECT to make the bucketing explicit if anyone reads the file.)
-- select count(*) from public.trades where asset_category in ('FXCFD','CASH');

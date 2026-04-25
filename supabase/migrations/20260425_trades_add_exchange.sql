-- ══════════════════════════════════════════════════════════════════════
-- Add an exchange column to trades.
--
-- IBKR's Flex Query already provides the venue per Trade (NASDAQ, DARK,
-- IBKRATS, LSE, IDEALFX, etc.). performUserSync was extracting it for
-- in-memory timezone math (api/_lib/exchangeTimezone.js) but never
-- persisting it. Storing it gives us:
--   - precise per-venue timezone resolution on future backfills (we had
--     to bucket by asset_category for the 20260425_backfill_trade_timezones
--     migration);
--   - "filled on NASDAQ" / "filled on DARK" UI cues if we want them later;
--   - cleaner debug when a fill's clock reading looks wrong.
--
-- New columns are NULL for historical rows. A re-sync would repopulate
-- the last 30 days with real values; older history stays NULL.
-- ══════════════════════════════════════════════════════════════════════

alter table public.trades
  add column if not exists exchange   varchar(16),
  add column if not exists order_type varchar(16);

-- order_type captures the IBKR order type at fill time (LMT, MKT, STP,
-- STPLMT, MIT, TRAIL, etc.). Useful later for execution-quality
-- analysis: "are my fills consistently giving up cents because I cross
-- the spread?", "am I respecting my plan's limits-only discipline?",
-- "are my stops getting run?". Same persistence pattern as exchange:
-- captured in the parser already, just need to thread it through the
-- upsert.

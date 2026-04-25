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
  add column if not exists exchange varchar(16);

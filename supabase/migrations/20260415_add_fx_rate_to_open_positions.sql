-- Add fx_rate_to_base to open_positions so we can convert unrealized P&L
-- across currencies when aggregating on HomeScreen.
--
-- IBKR emits fxRateToBase on every <OpenPosition> XML node (same as <Trade>),
-- so this is just wiring the existing field through. Populated going forward
-- by api/sync.js + IBKRScreen. No backfill needed — the sync flow does a
-- delete + re-insert of all positions, so the next sync after deploying the
-- code changes will write the FX rate for every row.

ALTER TABLE open_positions
  ADD COLUMN IF NOT EXISTS fx_rate_to_base double precision;

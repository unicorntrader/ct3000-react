-- Add currency column to planned_trades so we know what currency the
-- instrument trades in. Populated by PlanSheet via securities lookup.
-- For plans created before this migration, currency stays NULL and falls
-- back to baseCurrency on display. Backfilled during rebuild if a matching
-- logical_trade has a known currency.

ALTER TABLE planned_trades
  ADD COLUMN IF NOT EXISTS currency text;

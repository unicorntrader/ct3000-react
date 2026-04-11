ALTER TABLE logical_trades
  ADD COLUMN IF NOT EXISTS currency text;

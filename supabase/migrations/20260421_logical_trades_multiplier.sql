-- 20260421_logical_trades_multiplier.sql
--
-- Context: options P&L was computed in the FIFO builder using
--   lotPnl = qty × (close - entry) × sign
-- which is correct for equities (multiplier = 1) but wrong for options
-- (multiplier = 100 for standard US equity options). Example: an NVDA put
-- that closed +$1,292 in reality was showing +$12.92 in-app -- exactly
-- 100× understatement.
--
-- IBKR already sends `multiplier` per execution in the Flex XML and
-- api/sync.js writes it to `trades.multiplier`. We need to carry that
-- forward to `logical_trades` so the FIFO per-lot math and every
-- downstream display (cost basis, R-multiple, reverse-engineered exit
-- price) can use the correct contract size.
--
-- Existing rows get 1 as a safe default; they will be overwritten with
-- the correct multiplier the next time the user clicks Rebuild (since
-- rebuild delete-and-reinserts logical_trades).

ALTER TABLE public.logical_trades
  ADD COLUMN IF NOT EXISTS multiplier numeric DEFAULT 1;

COMMENT ON COLUMN public.logical_trades.multiplier IS
  'Contract multiplier carried forward from trades.multiplier. 1 for equities, 100 for standard US equity options, varies for futures. Used in per-lot P&L calc and downstream cost-basis / R-multiple displays.';

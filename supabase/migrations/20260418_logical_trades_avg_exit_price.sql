-- Store the real weighted-average close price on closed logical_trades.
-- Previously the UI reverse-engineered an "exit" from avg_entry_price,
-- total_closing_quantity, and total_realized_pnl. That's algebra, not
-- data -- when total_realized_pnl came from the old proportional-split
-- math, the derived exit was wildly off (e.g. CRWV showed $132.88
-- exit for a 50-share SHORT whose real close was $118.04).
--
-- The builder now captures coverPrice (weighted-avg of the closing
-- fills) and merges it into avg_exit_price during the FIFO cascade.
-- TradeInlineDetail reads this column directly with a fallback to the
-- legacy derived formula for rows inserted before this column existed.
--
-- Applied 2026-04-18.

ALTER TABLE public.logical_trades
  ADD COLUMN IF NOT EXISTS avg_exit_price numeric;

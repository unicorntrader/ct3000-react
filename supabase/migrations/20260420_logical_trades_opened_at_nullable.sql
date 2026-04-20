-- 20260420: allow logical_trades.opened_at to be NULL
--
-- Orphan logical trades (close executions whose matching open is outside
-- our 30-day sync window) genuinely don't have a known open date. Before
-- this migration, the FIFO builder was forced to write SOMETHING in the
-- NOT NULL column, and that something was the close date -- misleading
-- when displayed as "opened at".
--
-- After this migration, orphans can honestly store NULL, and the UI
-- renders "—" for the open date. Non-orphan trades are unaffected.
--
-- The FIFO builder (api/lib/logicalTradeBuilder.js) still writes
-- opened_at = closed_at for orphans until a follow-up commit flips it to
-- null. That follow-up should only land AFTER this migration runs in
-- Supabase, otherwise rebuild will fail with a NOT NULL constraint
-- violation (we've been there).
--
-- Run once in the Supabase SQL editor.

ALTER TABLE public.logical_trades
  ALTER COLUMN opened_at DROP NOT NULL;

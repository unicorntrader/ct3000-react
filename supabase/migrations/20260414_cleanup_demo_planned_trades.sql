-- Cleanup: remove orphaned demo/test rows from planned_trades
--
-- Background: WelcomeModal previously called /api/seed-demo for real paid users,
-- inserting is_demo=true rows (NVDA/AAPL/TSLA/SPY/MSFT) under their real user UUIDs.
-- That path is now removed. This migration cleans up any rows it left behind.
--
-- Run this once in the Supabase SQL editor.

-- 1. Delete any remaining is_demo=true rows in planned_trades
--    (these are safe to drop — real user plans are always is_demo=false)
delete from planned_trades
where is_demo = true;

-- 2. Also catch manually inserted test rows that slipped through without is_demo flag:
--    symbol is a common test ticker AND (notes is literally 'test' OR entry is a suspiciously round number)
delete from planned_trades
where symbol in ('AAPL', 'NVDA', 'MSFT', 'TSLA', 'SPY')
  and (
    lower(notes) = 'test'
    or lower(thesis) = 'test'
    or planned_entry_price in (100, 150, 200, 250, 300, 50, 400, 500)
  );

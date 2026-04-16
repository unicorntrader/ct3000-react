-- Collapse matching_status vocabulary from 5+ overlapping values to 3
-- mutually-exclusive states, and add a user_reviewed flag to replace the
-- preserve-across-rebuild semantics that the legacy 'manual' value carried.
--
-- Run this in the Supabase SQL editor at the same time as deploying the
-- code changes -- the new code drops support for the legacy values
-- (manual, ambiguous, auto, unmatched).

-- Step 1: Add user_reviewed flag. True when the user has explicitly acted
-- on the trade (picked a plan in /review, marked off-plan via bulk or
-- /review). applyPlanMatching will skip these rows on subsequent rebuilds
-- so the user's decision survives new sync runs.
ALTER TABLE public.logical_trades
  ADD COLUMN IF NOT EXISTS user_reviewed boolean NOT NULL DEFAULT false;

-- Step 2: Mark legacy 'manual' rows as user_reviewed -- they reflect past
-- user decisions from the old /review flow.
UPDATE public.logical_trades
SET user_reviewed = true
WHERE matching_status = 'manual';

-- Step 3: Collapse status values.
--
-- Mapping:
--   matched                            -> matched        (no change)
--   manual + planned_trade_id IS NOT NULL -> matched     (user picked a plan)
--   manual + planned_trade_id IS NULL  -> off_plan       (user said "no plan")
--   off_plan                           -> off_plan       (no change)
--   ambiguous                          -> needs_review   (rename)
--   auto                               -> needs_review   (transient; safe default)
--   unmatched                          -> off_plan       (legacy catch-all)
--
-- Safe to re-run (idempotent: after one pass all rows are in the 3 new
-- states and the WHERE clause matches nothing).
UPDATE public.logical_trades
SET matching_status = CASE
  WHEN matching_status = 'matched'                                        THEN 'matched'
  WHEN matching_status = 'off_plan'                                       THEN 'off_plan'
  WHEN matching_status = 'manual' AND planned_trade_id IS NOT NULL        THEN 'matched'
  WHEN matching_status = 'manual' AND planned_trade_id IS NULL            THEN 'off_plan'
  WHEN matching_status = 'ambiguous'                                      THEN 'needs_review'
  WHEN matching_status = 'auto'                                           THEN 'needs_review'
  WHEN matching_status = 'unmatched'                                      THEN 'off_plan'
  ELSE 'needs_review'  -- safety net for any unexpected value
END
WHERE matching_status NOT IN ('matched', 'needs_review', 'off_plan');

-- Backfill: existing 'unmatched' rows are semantically off-plan (zero plan
-- candidates found at build time). Flip them to the new first-class
-- 'off_plan' status so they drop out of the /review queue and are rendered
-- as "Off-plan" in the Journal.
--
-- Context: applyPlanMatching in api/rebuild.js previously wrote 'unmatched'
-- for zero-candidate trades, which surfaced them in /review with nothing for
-- the user to decide. New behavior writes 'off_plan' directly.
--
-- Safe to re-run (idempotent: after one pass there are no 'unmatched' rows).
UPDATE public.logical_trades
SET matching_status = 'off_plan',
    planned_trade_id = NULL,
    adherence_score  = NULL
WHERE matching_status = 'unmatched';

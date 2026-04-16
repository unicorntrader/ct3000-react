-- planned_trades.strategy was created NOT NULL in the Supabase UI before
-- migrations existed in the repo. The app (PlanSheet.jsx) already writes
-- `strategy: strategy || null` when the user doesn't pick one from the
-- dropdown, so the constraint was a latent bug waiting to fire. Drop it.

alter table planned_trades alter column strategy drop not null;

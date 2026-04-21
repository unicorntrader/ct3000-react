-- TradeSquares: per-day adherence aggregate.
--
-- Populated by api/rebuild.js after logical_trades are rebuilt. One row per
-- user per calendar day on which there was activity (matched, off-plan, or
-- needs-review trades).
--
-- adherence_score:
--   Average of logical_trades.adherence_score across MATCHED closed trades
--   on that day. off_plan and needs_review trades are excluded from the
--   average (rationale: off-plan was an unplannable opportunity, not a
--   discipline violation at the day level; needs_review is unresolved).
--   NULL if the day had no matched closed trades — UI renders those as
--   gray (no signal), not as a zero.
--
-- Counts are stored alongside so the UI can show context on click
-- ("3 trades: 2 matched, 1 off-plan") without a second query.

CREATE TABLE IF NOT EXISTS public.daily_adherence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date_key date NOT NULL,
  adherence_score numeric,                           -- null = no matched trades
  matched_count integer NOT NULL DEFAULT 0,
  off_plan_count integer NOT NULL DEFAULT 0,
  needs_review_count integer NOT NULL DEFAULT 0,
  trade_count integer NOT NULL DEFAULT 0,            -- total closed trades on the day
  computed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, date_key)
);

CREATE INDEX IF NOT EXISTS idx_daily_adherence_user_date
  ON public.daily_adherence (user_id, date_key DESC);

-- RLS: users see only their own rows. Service role (used by api/rebuild.js)
-- bypasses RLS, so writes work server-side.
ALTER TABLE public.daily_adherence ENABLE ROW LEVEL SECURITY;

CREATE POLICY "daily_adherence_select_own"
  ON public.daily_adherence
  FOR SELECT
  USING (auth.uid() = user_id);

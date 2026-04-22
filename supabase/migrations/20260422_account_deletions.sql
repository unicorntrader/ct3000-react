-- Feedback captured when a user deletes their account.
--
-- Kept after the user is gone (no FK to auth.users) so we can learn from
-- churn reasons. Two free-text columns match the two prompts in the UI:
--   "What did not work for you?"
--   "What would you like to see change?"
--
-- Email is stored plaintext (not hashed) so we can write back if they ask
-- to come back. Stripe customer id stored for cross-reference if they had
-- an active subscription history.
--
-- No RLS on this table for regular users — writes only come from the
-- /api/delete-account serverless function running under the service role,
-- and reads are admin-only (queried via Supabase dashboard or admin app).
create table if not exists account_deletions (
  id                    uuid primary key default gen_random_uuid(),
  deleted_at            timestamptz not null default now(),
  email                 text,
  stripe_customer_id    text,
  -- Two open-ended prompts, both optional. Free text, arbitrary length.
  what_didnt_work       text,
  what_would_you_change text
);

-- Index for browsing the most recent deletions — small table but still.
create index if not exists idx_account_deletions_deleted_at
  on account_deletions (deleted_at desc);

-- Explicitly deny all non-service-role access. The service-role client
-- bypasses RLS, so the delete-account endpoint can still write.
alter table account_deletions enable row level security;

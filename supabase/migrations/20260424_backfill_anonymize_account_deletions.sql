-- ══════════════════════════════════════════════════════════════════════
-- One-time backfill: anonymise any account_deletions rows that predate
-- the cron-anonymize-churn job.
--
-- api/cron-anonymize-churn.js enforces the 90-day retention clause
-- going forward, but rows deleted before that cron existed were never
-- scrubbed. This catches them up to policy.
--
-- Idempotent: UPDATE with WHERE on already-NULL columns is a no-op.
-- Safe to re-run. Today (BETA) this likely touches zero rows; it belongs
-- in the repo anyway so any fresh env applies the same retention policy
-- the first time migrations run.
-- ══════════════════════════════════════════════════════════════════════

update public.account_deletions
   set email = null,
       stripe_customer_id = null
 where deleted_at < now() - interval '90 days'
   and (email is not null or stripe_customer_id is not null);

-- 20260420: drop anonymous_sessions
--
-- The "Try demo" anonymous-user flow was retired on 2026-04-20. Signed-up
-- trial users already get demo data populated on first login (see variant D
-- / api/seed-demo.js) which covers the same try-the-product need without
-- the overhead of a parallel ephemeral session class. No writers or readers
-- of this table remain in the codebase.
--
-- Safe to drop: the table had a 48h TTL, no cleanup cron, and with anon
-- signups disabled in Supabase Auth there's nobody to insert into it. Any
-- historical rows are irrelevant now.
--
-- Run once in the Supabase SQL editor.

DROP TABLE IF EXISTS public.anonymous_sessions;

-- The has_seen_welcome column on user_subscriptions also became dead when
-- WelcomeModal.jsx was deleted (2026-04-20). Dropping here in the same
-- migration since both belong to the same sunset.
ALTER TABLE public.user_subscriptions
  DROP COLUMN IF EXISTS has_seen_welcome;

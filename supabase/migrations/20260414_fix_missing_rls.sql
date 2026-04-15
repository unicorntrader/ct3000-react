-- ══════════════════════════════════════════════════════════════════════
-- Enable RLS on tables flagged by the Supabase database linter.
--
-- Tables fixed:
--   1. securities          — reference data, keep existing public policy
--   2. anonymous_sessions  — per-user standard RLS
--   3. ghost_webhook_events — locked down (service_role only)
--   4. user_subscriptions  — SELECT only (webhook writes via service_role)
--   5. invited_users       — locked down (contains sensitive token column)
--
-- All API routes (api/*.js) use supabaseAdmin (service_role), which
-- bypasses RLS, so server-side writes continue to work.
-- ══════════════════════════════════════════════════════════════════════


-- ── 1. securities ─────────────────────────────────────────────────────
-- Reference data (list of symbols). Already has a "Securities are public"
-- policy; just flip RLS on.
alter table securities enable row level security;


-- ── 2. anonymous_sessions ─────────────────────────────────────────────
-- Users track their own anonymous demo sessions.
alter table anonymous_sessions enable row level security;

create policy "Users can select own anon session"
  on anonymous_sessions for select
  using (auth.uid() = user_id);

create policy "Users can insert own anon session"
  on anonymous_sessions for insert
  with check (auth.uid() = user_id);

create policy "Users can update own anon session"
  on anonymous_sessions for update
  using (auth.uid() = user_id);


-- ── 3. ghost_webhook_events ───────────────────────────────────────────
-- Webhook event log. No user should ever read or write this directly —
-- only webhooks (running as service_role) touch it. Enable RLS with NO
-- policies → locks out anon + authenticated roles entirely. service_role
-- still bypasses RLS, so webhooks keep working.
alter table ghost_webhook_events enable row level security;


-- ── 4. user_subscriptions ─────────────────────────────────────────────
-- Users can read their own subscription (the app does this on load).
-- Writes happen via the Stripe webhook using service_role, which
-- bypasses RLS — so no INSERT/UPDATE policies are needed.
alter table user_subscriptions enable row level security;

create policy "Users can select own subscription"
  on user_subscriptions for select
  using (auth.uid() = user_id);


-- ── 5. invited_users ──────────────────────────────────────────────────
-- Contains sensitive invite tokens. Users should NEVER be able to read,
-- write, or enumerate this table. Only api/redeem-invite.js (service_role)
-- touches it. Enable RLS with no policies → fully locked down.
alter table invited_users enable row level security;

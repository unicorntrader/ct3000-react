-- ══════════════════════════════════════════════════════════════════════
-- Reconcile user_subscriptions RLS history.
--
-- 20260411_create_user_subscriptions.sql declared:
--   - "Users can read own subscription"   (SELECT)
--   - "Users can insert own subscription" (INSERT)
--   - "Users can update own subscription" (UPDATE)
-- all keyed on auth.uid() = user_id.
--
-- Those INSERT / UPDATE policies are a paywall-bypass: an authenticated
-- user could PATCH their own row to subscription_status = 'active' and
-- App.jsx's isActive() gate would let them into the product for free.
-- Writes are only supposed to happen via the Stripe webhook running under
-- service_role (which bypasses RLS).
--
-- Prod was cleaned up manually in Supabase Studio — the 2026-04-17
-- baseline snapshot shows only the "Users can select own subscription"
-- policy from 20260414_fix_missing_rls.sql. But the drop was never
-- committed, so re-bootstrapping from supabase/migrations/ re-introduces
-- the vulnerable policies.
--
-- This migration drops all three by name. Idempotent (IF EXISTS), safe
-- to re-run, and in prod it is a no-op.
-- ══════════════════════════════════════════════════════════════════════

drop policy if exists "Users can read own subscription"   on public.user_subscriptions;
drop policy if exists "Users can insert own subscription" on public.user_subscriptions;
drop policy if exists "Users can update own subscription" on public.user_subscriptions;

-- ══════════════════════════════════════════════════════════════════════
-- Authoritative, deny-by-default read grants on user_ibkr_credentials.
--
-- Supersedes 20260424_revoke_ibkr_secret_columns.sql (which only
-- column-revoked ibkr_token and query_id_30d). That approach was
-- allow-list-by-omission: a future sensitive column added to the table
-- would be browser-readable unless someone remembers to revoke it.
--
-- This migration flips the model:
--   1. REVOKE all column SELECT from anon + authenticated.
--   2. GRANT SELECT only on columns that are safe for the browser.
--
-- Net effect:
--   - browser (anon + authenticated roles) can read: id, user_id,
--     account_id, last_sync_at, created_at, updated_at, token_masked,
--     query_id_masked, base_currency, auto_sync_enabled,
--     last_sync_error, last_sync_failed_at
--   - browser cannot read: ibkr_token, query_id_30d
--   - any future column added to this table is denied by default;
--     adding it to the safe list is an explicit, reviewable change
--
-- Writes (INSERT/UPDATE/DELETE) are untouched -- still gated by row-level
-- policies. The IBKR connect flow (browser -> upsert) still works.
-- Server endpoints use service_role which bypasses column grants entirely.
-- ══════════════════════════════════════════════════════════════════════

-- Step 1: deny all column SELECT to the two browser roles.
revoke select on public.user_ibkr_credentials from anon, authenticated;

-- Step 2: grant SELECT only on columns the browser is allowed to see.
-- Keep this list in sync when new non-secret columns are added to the
-- table. Never add ibkr_token or query_id_30d here.
grant select (
  id,
  user_id,
  account_id,
  last_sync_at,
  created_at,
  updated_at,
  token_masked,
  query_id_masked,
  base_currency,
  auto_sync_enabled,
  last_sync_error,
  last_sync_failed_at
) on public.user_ibkr_credentials to authenticated;

-- anon role gets nothing -- there is no valid reason for pre-auth users
-- to read anyone's IBKR credentials row, even masked values. If a public
-- display ever needs anything from this table, change the policy here
-- explicitly rather than widening anon's access by default.

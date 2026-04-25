-- ══════════════════════════════════════════════════════════════════════
-- Restrict browser writes on user_ibkr_credentials.
--
-- Pairs with /api/ibkr-credentials (the new server endpoint). With that
-- endpoint in place, the browser no longer needs INSERT or DELETE on
-- this table -- credential save / remove flows go through the service-
-- role API. UPDATE is also server-only EXCEPT for the auto-sync toggle,
-- which is a non-secret boolean the user flips from the IBKR screen.
--
-- Effect:
--   - anon, authenticated     : no INSERT, UPDATE, DELETE
--   - authenticated           : UPDATE allowed only on the
--                               auto_sync_enabled column
--   - service_role            : unaffected (bypasses column grants)
--
-- Read grants from 20260425_ibkr_credentials_safe_column_grant.sql
-- stay as-is: SELECT on safe columns (masked variants + metadata) is
-- still permitted to authenticated.
--
-- Row-level RLS policies (Users can insert/update/delete own ibkr...)
-- are left in place for defense in depth -- the column-level revokes
-- already block the writes at a lower layer, and dropping the policies
-- isn't necessary to close the security gap.
-- ══════════════════════════════════════════════════════════════════════

-- Step 1: revoke all write privileges from the browser roles.
revoke insert, update, delete on public.user_ibkr_credentials from anon, authenticated;

-- Step 2: re-grant UPDATE only on the auto_sync_enabled column. This is
-- the toggle on the IBKR screen; the value isn't sensitive and it would
-- be unnecessary surface area to push it through an HTTP endpoint.
grant update (auto_sync_enabled) on public.user_ibkr_credentials to authenticated;

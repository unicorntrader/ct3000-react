-- ══════════════════════════════════════════════════════════════════════
-- Hide raw IBKR secret columns from the browser role.
--
-- RLS on user_ibkr_credentials gates rows (a user sees only their own),
-- but every column on that row is still readable by the authenticated
-- role -- including the raw ibkr_token and query_id_30d. The UI only
-- ever selects the masked variants (token_masked / query_id_masked),
-- but nothing prevents malicious JS running in the tab (compromised
-- dep, browser extension, XSS) from asking for the raw values.
--
-- This revoke says: the anon + authenticated roles are not allowed to
-- SELECT these two columns. Everything else about the row stays visible.
--
-- Unaffected by this change:
--   - Browser WRITES (upsert from IBKRScreen.jsx) -- needs INSERT/UPDATE,
--     not SELECT, so it keeps working.
--   - Server reads via supabaseAdmin -- service_role bypasses column
--     grants, so api/sync.js, api/cron-sync.js etc. keep working.
--   - Row-level policies on user_ibkr_credentials -- untouched.
--
-- After this migration, a browser running
--     supabase.from('user_ibkr_credentials').select('ibkr_token')
-- gets "permission denied for column ibkr_token". A select('*') call
-- quietly omits the restricted columns.
-- ══════════════════════════════════════════════════════════════════════

revoke select (ibkr_token, query_id_30d)
  on public.user_ibkr_credentials
  from anon, authenticated;

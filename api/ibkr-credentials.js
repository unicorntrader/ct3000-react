const { createClient } = require('@supabase/supabase-js');
const { captureServerError } = require('./_lib/sentry');

// Server-side ownership of IBKR credential writes. Closes the last
// browser-write hole on user_ibkr_credentials -- the column REVOKE that
// shipped earlier (20260425_ibkr_credentials_safe_column_grant.sql)
// already prevented the browser from *reading* raw ibkr_token /
// query_id_30d, but the browser still upserted those columns directly
// when a user connected IBKR. After this endpoint exists and the
// matching migration revokes browser INSERT/UPDATE/DELETE, the raw
// secrets never traverse the anon/authenticated DB role at all.
//
// Two methods on one path -- match how /api/billing-portal etc. are
// shaped:
//   POST   /api/ibkr-credentials  { token, queryId }   -> upsert row
//   DELETE /api/ibkr-credentials                       -> delete row
//
// Auth: Bearer Supabase JWT. user_id is taken from the JWT, not the
// body, so a user cannot write credentials for another account.
//
// auto_sync_enabled toggle stays as a direct browser UPDATE (the
// migration grants UPDATE only on that one column to authenticated).
// Adding it here would make the API surface bigger for no security
// gain -- the toggle isn't a secret.

const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || 'https://ct3000-react.vercel.app';

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Length bands chosen to be loose enough to accept any real IBKR Flex
// credential while still catching obvious garbage. The query_id_30d
// column is varchar(16) so anything longer would 500 the upsert
// further downstream.
const MIN_TOKEN_LEN     = 8;
const MAX_TOKEN_LEN     = 256;
const MIN_QUERY_ID_LEN  = 1;
const MAX_QUERY_ID_LEN  = 16;

function maskToken(token) {
  if (!token) return '';
  if (token.length <= 4) return '•'.repeat(token.length);
  return '•'.repeat(token.length - 4) + token.slice(-4);
}

function maskQueryId(queryId) {
  if (!queryId) return '';
  if (queryId.length <= 2) return '•'.repeat(queryId.length);
  return '•'.repeat(queryId.length - 2) + queryId.slice(-2);
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST' && req.method !== 'DELETE') {
    return res.status(405).json({ error: `Method not allowed: ${req.method}` });
  }

  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing Authorization header' });
  }
  const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(authHeader.slice(7));
  if (authError || !user) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  // ── DELETE: remove the user's credentials row ─────────────────────────
  if (req.method === 'DELETE') {
    try {
      const { error } = await supabaseAdmin
        .from('user_ibkr_credentials')
        .delete()
        .eq('user_id', user.id);
      if (error) throw error;
      console.log('[ibkr-credentials] deleted for userId:', user.id);
      return res.status(200).json({ success: true });
    } catch (err) {
      console.error('[ibkr-credentials] DELETE failed:', err.message);
      await captureServerError(err, { userId: user.id, route: 'ibkr-credentials', method: 'DELETE' });
      return res.status(500).json({ error: err.message });
    }
  }

  // ── POST: save / update the user's credentials ───────────────────────
  const body = req.body || {};
  const token = (body.token || '').toString().trim();
  const queryId = (body.queryId || '').toString().trim();

  if (!token || !queryId) {
    return res.status(400).json({ error: 'Both Flex token and Query ID are required.' });
  }
  if (token.length < MIN_TOKEN_LEN || token.length > MAX_TOKEN_LEN) {
    return res.status(400).json({
      error: `Flex token length looks wrong (${token.length} chars). IBKR tokens are typically 20+ characters.`,
    });
  }
  if (queryId.length < MIN_QUERY_ID_LEN || queryId.length > MAX_QUERY_ID_LEN) {
    return res.status(400).json({
      error: `Query ID length looks wrong (${queryId.length} chars). IBKR Query IDs are typically 6-7 digits.`,
    });
  }

  const tokenMasked = maskToken(token);
  const queryIdMasked = maskQueryId(queryId);

  try {
    const { error } = await supabaseAdmin
      .from('user_ibkr_credentials')
      .upsert({
        user_id: user.id,
        ibkr_token: token,
        query_id_30d: queryId,
        token_masked: tokenMasked,
        query_id_masked: queryIdMasked,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' });
    if (error) throw error;
    console.log('[ibkr-credentials] saved for userId:', user.id);
    return res.status(200).json({
      success: true,
      tokenMasked,
      queryIdMasked,
    });
  } catch (err) {
    console.error('[ibkr-credentials] POST failed:', err.message);
    await captureServerError(err, { userId: user.id, route: 'ibkr-credentials', method: 'POST' });
    return res.status(500).json({ error: err.message });
  }
};

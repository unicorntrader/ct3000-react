const { createClient } = require('@supabase/supabase-js');
const { performUserSync } = require('./_lib/performUserSync');
const { captureServerError } = require('./_lib/sentry');

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Nightly cron. Fires from Vercel's scheduler (see vercel.json "crons").
// Vercel sends "Authorization: Bearer <CRON_SECRET>" on every scheduled
// invocation, so verifying that header gates out random public traffic.
//
// Loops every user with IBKR creds on file, syncs each one inside a
// try/catch so a single failure does not kill the rest of the run, and
// records failure state on user_ibkr_credentials so the UI can surface it.
module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const expected = process.env.CRON_SECRET;
  const got = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!expected || got !== expected) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { data: users, error: fetchError } = await supabaseAdmin
    .from('user_ibkr_credentials')
    .select('user_id')
    .not('ibkr_token', 'is', null)
    .not('query_id_30d', 'is', null)
    .eq('auto_sync_enabled', true);

  if (fetchError) {
    console.error('[cron-sync] failed to list users:', fetchError.message);
    await captureServerError(fetchError, { route: 'cron-sync', step: 'list-users' });
    return res.status(500).json({ error: fetchError.message });
  }

  const results = { attempted: 0, succeeded: 0, failed: 0, failures: [] };

  for (const { user_id: userId } of (users || [])) {
    results.attempted++;
    const startedAt = Date.now();
    try {
      const out = await performUserSync(userId, supabaseAdmin);
      results.succeeded++;
      console.log(`[cron-sync] user=${userId} ok — trades=${out.tradeCount} positions=${out.positionCount} logical=${out.logicalCount} (${Date.now() - startedAt}ms)`);
    } catch (err) {
      results.failed++;
      const message = err?.message || String(err);
      results.failures.push({ userId, message });
      console.error(`[cron-sync] user=${userId} FAILED (${Date.now() - startedAt}ms):`, message);
      await captureServerError(err instanceof Error ? err : new Error(message), {
        userId, route: 'cron-sync', step: 'per-user-sync',
      });
      await supabaseAdmin
        .from('user_ibkr_credentials')
        .update({
          last_sync_error: message.slice(0, 500),
          last_sync_failed_at: new Date().toISOString(),
        })
        .eq('user_id', userId);
    }
  }

  console.log(`[cron-sync] done — attempted=${results.attempted} ok=${results.succeeded} failed=${results.failed}`);
  return res.status(200).json(results);
};

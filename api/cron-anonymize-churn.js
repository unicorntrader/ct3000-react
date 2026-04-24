const { createClient } = require('@supabase/supabase-js');
const { captureServerError } = require('./_lib/sentry');

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Weekly cron. Fires from Vercel's scheduler (see vercel.json "crons").
//
// Honors the retention clause of the privacy policy:
//   "Identifying metadata retained for churn analysis (email, Stripe
//    customer ID) is stripped after 90 days."
//
// The immediate account wipe already happens inside /api/delete-account.
// This cron only scrubs the feedback row on account_deletions once the
// 90-day window has passed — email + stripe_customer_id go to null,
// leaving the anonymous churn note intact.
//
// Idempotent: re-running against already-anonymised rows is a no-op (the
// WHERE clause skips rows that already have both columns null).
module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const expected = process.env.CRON_SECRET;
  const got = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!expected || got !== expected) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const cutoffIso = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();

  try {
    // Supabase PostgREST can't express "email IS NOT NULL OR stripe_customer_id
    // IS NOT NULL" cleanly with .or(), and we don't want to pull every row
    // just to count. Simplest: two updates, each idempotent on its own.
    const [emailRes, stripeRes] = await Promise.all([
      supabaseAdmin
        .from('account_deletions')
        .update({ email: null })
        .lt('deleted_at', cutoffIso)
        .not('email', 'is', null)
        .select('id'),
      supabaseAdmin
        .from('account_deletions')
        .update({ stripe_customer_id: null })
        .lt('deleted_at', cutoffIso)
        .not('stripe_customer_id', 'is', null)
        .select('id'),
    ]);

    if (emailRes.error) throw emailRes.error;
    if (stripeRes.error) throw stripeRes.error;

    const emailScrubbed = emailRes.data?.length || 0;
    const stripeScrubbed = stripeRes.data?.length || 0;

    console.log(`[cron-anonymize-churn] cutoff=${cutoffIso} email=${emailScrubbed} stripe=${stripeScrubbed}`);
    return res.status(200).json({
      success: true,
      cutoff: cutoffIso,
      emailScrubbed,
      stripeScrubbed,
    });
  } catch (err) {
    console.error('[cron-anonymize-churn] failed:', err?.message || err);
    await captureServerError(err, { route: 'cron-anonymize-churn' });
    return res.status(500).json({ error: err?.message || 'Anonymize failed' });
  }
};

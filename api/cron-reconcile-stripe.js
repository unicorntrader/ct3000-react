const Stripe = require('stripe');
const { createClient } = require('@supabase/supabase-js');
const { captureServerError } = require('./_lib/sentry');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const tsFromUnix = (s) => (s ? new Date(s * 1000).toISOString() : null);

// Hourly reconciliation cron — backstop for missed Stripe webhooks.
//
// Iterates every user_subscriptions row with a stripe_customer_id, fetches
// the most recent subscription for that customer from Stripe, and writes
// the result into the mirror columns (stripe_subscription_status,
// stripe_trial_end, etc). Mirror columns are written for ALL users
// regardless of comp; gate columns (subscription_status / trial_ends_at /
// current_period_ends_at) only for non-comped users — same rule as the
// webhook in api/stripe-webhook.js.
//
// This deliberately never touches is_comped (admin-controlled) and never
// pushes anything TO Stripe (read-only mirror). Sole job is to catch drift
// when webhooks failed to reach us — Vercel down at delivery time, signature
// secret rotation, deploy windows, etc.
//
// Cost: one Stripe API call per user with a stripe_customer_id, once an
// hour. At Stripe's 100 req/sec read limit, this scales to tens of
// thousands of users without rate concerns.
module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const expected = process.env.CRON_SECRET;
  const got = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!expected || got !== expected) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { data: rows, error: fetchError } = await supabaseAdmin
    .from('user_subscriptions')
    .select('user_id, stripe_customer_id, stripe_subscription_id, stripe_subscription_status, is_comped')
    .not('stripe_customer_id', 'is', null);

  if (fetchError) {
    console.error('[cron-reconcile-stripe] failed to list users:', fetchError.message);
    await captureServerError(fetchError, { route: 'cron-reconcile-stripe', step: 'list-users' });
    return res.status(500).json({ error: fetchError.message });
  }

  const results = {
    attempted: 0,
    synced: 0,
    drift_detected: 0,
    cleared_no_sub: 0,
    errored: 0,
  };

  for (const row of (rows || [])) {
    results.attempted++;
    try {
      const subs = await stripe.subscriptions.list({
        customer: row.stripe_customer_id,
        status: 'all',
        limit: 1,
      });
      const subscription = subs.data[0];

      if (!subscription) {
        // Stripe has the customer but no subscription. Clear the mirror so
        // admin sees the truth.
        await supabaseAdmin
          .from('user_subscriptions')
          .update({
            stripe_subscription_id: null,
            stripe_subscription_status: null,
            stripe_trial_end: null,
            stripe_current_period_end: null,
            stripe_canceled_at: null,
            stripe_synced_at: new Date().toISOString(),
          })
          .eq('user_id', row.user_id);
        results.cleared_no_sub++;
        continue;
      }

      const status = subscription.status;
      const trialEnd = tsFromUnix(subscription.trial_end);
      const periodEnd = tsFromUnix(subscription.current_period_end);
      const canceledAt = tsFromUnix(subscription.canceled_at);

      const payload = {
        stripe_subscription_id: subscription.id,
        stripe_subscription_status: status,
        stripe_trial_end: trialEnd,
        stripe_current_period_end: periodEnd,
        stripe_canceled_at: canceledAt,
        stripe_synced_at: new Date().toISOString(),
      };
      if (!row.is_comped) {
        payload.subscription_status = status;
        payload.trial_ends_at = trialEnd;
        payload.current_period_ends_at = periodEnd;
      }

      // Cheap drift detector — counts as drift if we found state we
      // didn't already have. Doesn't catch every form of drift but
      // surfaces the obvious "webhook never wrote anything" case.
      if (
        row.stripe_subscription_id !== subscription.id ||
        row.stripe_subscription_status !== status
      ) {
        results.drift_detected++;
      }

      const { error: updateErr } = await supabaseAdmin
        .from('user_subscriptions')
        .update(payload)
        .eq('user_id', row.user_id);
      if (updateErr) throw updateErr;
      results.synced++;
    } catch (err) {
      results.errored++;
      console.error(`[cron-reconcile-stripe] user=${row.user_id} FAILED:`, err?.message || err);
      await captureServerError(err instanceof Error ? err : new Error(String(err)), {
        userId: row.user_id, route: 'cron-reconcile-stripe', step: 'per-user-sync',
      });
      // Continue to next user — one bad customer shouldn't break the run.
    }
  }

  console.log(
    `[cron-reconcile-stripe] done — attempted=${results.attempted} synced=${results.synced} ` +
    `drift=${results.drift_detected} errored=${results.errored} no_sub=${results.cleared_no_sub}`
  );
  return res.status(200).json(results);
};

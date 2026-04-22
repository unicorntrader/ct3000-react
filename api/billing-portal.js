const Stripe = require('stripe');
const { createClient } = require('@supabase/supabase-js');

/**
 * Creates a Stripe Billing Portal session for the authenticated user.
 *
 * The billing portal lets customers self-service:
 *   - update payment method
 *   - view invoices / download receipts
 *   - change plan (upgrade / downgrade)
 *   - cancel the subscription
 *
 * Without this endpoint the user has NO path to cancel — the create-checkout
 * flow creates customers but never surfaced their portal. Ship-blocker for
 * BETA: users need to be able to quit without emailing us.
 *
 * Auth: Bearer token (same pattern as create-checkout-session, rebuild, sync).
 * Looks up the user's stripe_customer_id from user_subscriptions — bails with
 * a helpful error if they don't have one yet (e.g. comped users never went
 * through checkout).
 */

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || 'https://ct3000-react.vercel.app';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // 1. Auth — identical pattern to create-checkout-session.js
  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing Authorization header' });
  }
  const token = authHeader.slice(7);
  const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
  if (authError || !user) {
    console.log('[billing-portal] auth failed:', authError?.message);
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  const appUrl = process.env.APP_URL || 'https://ct3000-react.vercel.app';

  try {
    // 2. Look up the Stripe customer ID we saved during checkout. Comped
    //    users (invite redemption) never hit checkout, so they legitimately
    //    have no customer — handle with a clear error, not a crash.
    const { data: sub } = await supabaseAdmin
      .from('user_subscriptions')
      .select('stripe_customer_id, is_comped')
      .eq('user_id', user.id)
      .maybeSingle();

    if (!sub?.stripe_customer_id) {
      if (sub?.is_comped) {
        return res.status(400).json({
          error: 'Your account is on a complimentary plan — no billing to manage. Email support if you need to close your account.',
        });
      }
      return res.status(400).json({
        error: 'No billing record found. Please start a subscription first.',
      });
    }

    // 3. Create the portal session. return_url brings the user back to
    //    Settings after they're done; the portal auto-redirects on cancel
    //    too.
    const portal = await stripe.billingPortal.sessions.create({
      customer: sub.stripe_customer_id,
      return_url: `${appUrl}/settings`,
    });
    console.log('[billing-portal] created session for userId:', user.id);

    return res.status(200).json({ url: portal.url });
  } catch (err) {
    console.error('[billing-portal] error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};

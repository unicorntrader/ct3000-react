const Stripe = require('stripe');
const { createClient } = require('@supabase/supabase-js');
const { captureServerError } = require('./_lib/sentry');

/**
 * Permanent account deletion with GDPR-style full wipe.
 *
 * Two-step UX (enforced by the UI, re-checked here for safety):
 *   1. User must cancel their Stripe subscription first (via the billing
 *      portal). We refuse to delete while a subscription is active or
 *      trialing — otherwise the card keeps getting charged after the
 *      account record is gone.
 *   2. Once cancelled, the user can delete. We collect a feedback payload
 *      and wipe every user-owned row across every table, then delete the
 *      auth.users row via admin API.
 *
 * Table deletion order respects FK relationships:
 *   - logical_trade_executions  -> depends on logical_trades
 *   - logical_trades            -> depends on trades (via plan matching)
 *   - daily_adherence           -> independent (may not exist on all envs)
 *   - weekly_reviews            -> independent
 *   - daily_notes               -> independent
 *   - planned_trades            -> independent
 *   - playbooks                 -> referenced by planned_trades.playbook_id
 *   - open_positions            -> independent
 *   - trades                    -> independent
 *   - user_ibkr_credentials     -> independent
 *   - user_subscriptions        -> independent (Stripe side already cancelled)
 *   - missed_trades             -> independent (table may be empty)
 *   - admin_actions             -> preserved (audit trail)
 *   - invited_users             -> preserved (invite history for admin)
 *
 * Feedback is written to account_deletions BEFORE the wipe so the user's
 * why-I-left note survives everything. The auth.users delete is the last
 * step so a mid-wipe failure leaves a recoverable state.
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

  // ── Auth ────────────────────────────────────────────────────────────────
  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing Authorization header' });
  }
  const token = authHeader.slice(7);
  const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
  if (authError || !user) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
  const userId = user.id;
  const userEmail = user.email;

  // Feedback payload — both fields are optional free text.
  const whatDidntWork = (req.body?.what_didnt_work || '').toString().trim().slice(0, 5000);
  const whatWouldYouChange = (req.body?.what_would_you_change || '').toString().trim().slice(0, 5000);

  try {
    // ── Subscription guard ────────────────────────────────────────────────
    // Must have no active/trialing subscription. Comped users pass this
    // because is_comped doesn't go through Stripe.
    const { data: sub } = await supabaseAdmin
      .from('user_subscriptions')
      .select('stripe_customer_id, subscription_status, is_comped')
      .eq('user_id', userId)
      .maybeSingle();

    const isBillingActive = sub
      && !sub.is_comped
      && (sub.subscription_status === 'active' || sub.subscription_status === 'trialing');

    if (isBillingActive) {
      return res.status(400).json({
        error: 'Please cancel your subscription before deleting your account. You can cancel from Settings → Manage subscription.',
      });
    }

    // ── Capture feedback FIRST ────────────────────────────────────────────
    // If the wipe fails halfway, we still have the user's why-I-left note
    // on record. Failure here is non-fatal — we log and continue.
    //
    // Privacy stance: anonymous by default. We no longer record email or
    // stripe_customer_id on new deletion rows. The columns still exist on
    // account_deletions so pre-cutover rows can continue to be anonymised
    // by api/cron-anonymize-churn.js on the 90-day schedule; new rows
    // land already-anonymous, which is what a deleted user reasonably
    // expects.
    const { error: feedbackErr } = await supabaseAdmin
      .from('account_deletions')
      .insert({
        email: null,
        stripe_customer_id: null,
        what_didnt_work: whatDidntWork || null,
        what_would_you_change: whatWouldYouChange || null,
      });
    if (feedbackErr) {
      console.error('[delete-account] feedback insert failed:', feedbackErr.message);
      // Intentionally not returning — feedback loss is worse than blocking
      // the deletion. Sentry will catch it.
      await captureServerError(feedbackErr, { userId, step: 'save-feedback', route: 'delete-account' });
    }

    // ── Wipe user-owned rows ──────────────────────────────────────────────
    // Order matters only for FK respect. Everything else is parallelizable,
    // but sequential is fine here — deletion is rare and we want clear
    // error attribution.
    const tables = [
      'logical_trade_executions',
      'logical_trades',
      'daily_adherence',          // on tradesquares branch; may 404 on main
      'weekly_reviews',
      'daily_notes',
      'planned_trades',
      'playbooks',
      'open_positions',
      'trades',
      'user_ibkr_credentials',
      'user_subscriptions',
      'missed_trades',
    ];

    for (const t of tables) {
      const { error } = await supabaseAdmin.from(t).delete().eq('user_id', userId);
      if (error) {
        // 42P01 = undefined_table. Expected for tables that don't exist on
        // this env (e.g. daily_adherence before its migration ran).
        if (error.code === '42P01') {
          console.log(`[delete-account] skipped (table missing): ${t}`);
          continue;
        }
        console.error(`[delete-account] wipe failed at ${t}:`, error.message);
        await captureServerError(error, { userId, step: `wipe-${t}`, route: 'delete-account' });
        return res.status(500).json({
          error: `Failed to delete your data (${t}). Please email support so we can finish the deletion manually.`,
        });
      }
    }

    // ── Finally, delete the auth.users record ────────────────────────────
    // Done LAST so a mid-wipe failure leaves a recoverable state (user can
    // still log in, we can retry). Once this succeeds, the token they're
    // holding is invalid and they're signed out server-side.
    const { error: authDeleteErr } = await supabaseAdmin.auth.admin.deleteUser(userId);
    if (authDeleteErr) {
      console.error('[delete-account] auth.deleteUser failed:', authDeleteErr.message);
      await captureServerError(authDeleteErr, { userId, step: 'auth-delete', route: 'delete-account' });
      return res.status(500).json({
        error: 'Your data was deleted but the account record could not be removed. Please email support to finish.',
      });
    }

    console.log('[delete-account] userId=%s email=%s completed', userId, userEmail);
    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('[delete-account] unexpected error:', err.message);
    await captureServerError(err, { userId, step: 'outer', route: 'delete-account' });
    return res.status(500).json({ error: err.message });
  }
};

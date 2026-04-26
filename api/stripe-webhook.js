const Stripe = require('stripe');
const { createClient } = require('@supabase/supabase-js');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

const tsFromUnix = (s) => (s ? new Date(s * 1000).toISOString() : null);

// Build the upsert/update payload for a user_subscriptions row from a Stripe
// subscription object.
//
// Always writes Stripe mirror columns (stripe_*) so admin / debugging can
// see Stripe's actual state regardless of comp.
//
// Gate columns (subscription_status / trial_ends_at / current_period_ends_at)
// are written ONLY for non-comped users. For comped users they're owned by
// the comp model (status='active', dates pinned to 2099) and must not be
// overwritten by a Stripe event — that's how a phantom Stripe subscription
// can exist alongside an active comp without revoking access.
//
// isCompedOverride: pass it if the caller already looked up is_comped (saves
// a round-trip in the updated/deleted handlers). Otherwise we look it up.
async function buildWritePayload({ userId, customerId, subscription, isCompedOverride }) {
  let isComped = isCompedOverride;
  if (isComped === undefined) {
    const { data } = await supabaseAdmin
      .from('user_subscriptions')
      .select('is_comped')
      .eq('user_id', userId)
      .maybeSingle();
    isComped = !!data?.is_comped;
  }

  const status = subscription.status;
  const trialEnd = tsFromUnix(subscription.trial_end);
  const periodEnd = tsFromUnix(subscription.current_period_end);
  const canceledAt = tsFromUnix(subscription.canceled_at);

  const payload = {
    // Linkage — always written
    stripe_customer_id: customerId,
    stripe_subscription_id: subscription.id,
    // Mirror — always written, regardless of comp
    stripe_subscription_status: status,
    stripe_trial_end: trialEnd,
    stripe_current_period_end: periodEnd,
    stripe_canceled_at: canceledAt,
    stripe_synced_at: new Date().toISOString(),
  };

  if (!isComped) {
    payload.subscription_status = status;
    payload.trial_ends_at = trialEnd;
    payload.current_period_ends_at = periodEnd;
  }

  return payload;
}

async function handler(req, res) {
  console.log('[webhook] invoked — method:', req.method);

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const sig = req.headers['stripe-signature'];
  if (!sig) return res.status(400).json({ error: 'Missing stripe-signature header' });

  // Read raw body as Buffer — required for signature verification
  const rawBody = await getRawBody(req);
  console.log('[webhook] received body length:', rawBody.length);

  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('[webhook] signature verification failed:', err.message);
    return res.status(400).json({ error: `Webhook Error: ${err.message}` });
  }
  console.log('[webhook] verified event type:', event.type, '| id:', event.id);

  // Idempotency. Stripe retries webhooks on any 5XX or network blip; without
  // this guard, a retried checkout.session.completed would re-run and could
  // downgrade a freshly active sub back to trialing or reset trial_ends_at.
  // The unique pk on processed_stripe_events.event_id makes the insert race-
  // safe — only one of N concurrent retries wins; the rest hit 23505 and
  // return 200 (so Stripe stops retrying).
  const { error: dedupErr } = await supabaseAdmin
    .from('processed_stripe_events')
    .insert({ event_id: event.id, event_type: event.type });
  if (dedupErr) {
    if (dedupErr.code === '23505') {
      console.log('[webhook] event already processed — skipping:', event.id);
      return res.status(200).json({ received: true, deduped: true });
    }
    console.error('[webhook] dedup insert error:', dedupErr.message);
    // Fall through and process anyway — better to risk a duplicate than to
    // drop the event entirely on a transient DB hiccup.
  }

  try {
    switch (event.type) {

      case 'checkout.session.completed': {
        const session = event.data.object;
        const customerId = session.customer;
        const subscriptionId = session.subscription;
        console.log('[webhook] checkout.session.completed — customerId:', customerId, '| subscriptionId:', subscriptionId);
        console.log('[webhook] session.metadata:', JSON.stringify(session.metadata));

        // Primary: get userId from session metadata
        let userId = session.metadata?.supabase_user_id;
        console.log('[webhook] userId from metadata:', userId);

        // Fallback: look up by stripe_customer_id (written at customer-creation time)
        if (!userId) {
          console.log('[webhook] metadata missing — falling back to stripe_customer_id lookup');
          const { data: row, error: lookupErr } = await supabaseAdmin
            .from('user_subscriptions')
            .select('user_id')
            .eq('stripe_customer_id', customerId)
            .maybeSingle();
          if (lookupErr) console.error('[webhook] fallback lookup error:', lookupErr.message);
          userId = row?.user_id;
          console.log('[webhook] fallback lookup userId:', userId);
        }

        if (!userId) {
          console.error('[webhook] FATAL: cannot identify user — no metadata and no matching customer row. customerId:', customerId);
          // Return 200 so Stripe doesn't retry — this is a data issue, not a transient error
          return res.status(200).json({ received: true, warning: 'user not identified' });
        }

        // Fetch subscription from Stripe to get accurate status + dates
        console.log('[webhook] retrieving subscription:', subscriptionId);
        const subscription = await stripe.subscriptions.retrieve(subscriptionId);
        const payload = await buildWritePayload({ userId, customerId, subscription });
        const { error: upsertErr } = await supabaseAdmin
          .from('user_subscriptions')
          .upsert({ user_id: userId, ...payload }, { onConflict: 'user_id' });
        if (upsertErr) {
          console.error('[webhook] upsert FAILED — userId:', userId, '| error:', upsertErr.message);
          return res.status(500).json({ error: upsertErr.message });
        }
        console.log('[webhook] upsert SUCCESS — userId:', userId, '| keys:', Object.keys(payload).join(','));
        break;
      }

      case 'customer.subscription.updated': {
        const subscription = event.data.object;
        console.log('[webhook] subscription.updated — id:', subscription.id, '| status:', subscription.status);

        const { data: subRow } = await supabaseAdmin
          .from('user_subscriptions')
          .select('user_id, is_comped')
          .eq('stripe_subscription_id', subscription.id)
          .maybeSingle();
        if (!subRow) {
          console.log('[webhook] no row matching subscription_id — ignoring:', subscription.id);
          break;
        }

        const payload = await buildWritePayload({
          userId: subRow.user_id,
          customerId: subscription.customer,
          subscription,
          isCompedOverride: subRow.is_comped,
        });
        const { error: updateErr } = await supabaseAdmin
          .from('user_subscriptions')
          .update(payload)
          .eq('stripe_subscription_id', subscription.id);
        if (updateErr) console.error('[webhook] update error:', updateErr.message);
        else console.log('[webhook] updated — keys:', Object.keys(payload).join(','));
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object;
        console.log('[webhook] subscription.deleted — id:', subscription.id);

        const { data: delRow } = await supabaseAdmin
          .from('user_subscriptions')
          .select('user_id, is_comped')
          .eq('stripe_subscription_id', subscription.id)
          .maybeSingle();
        if (!delRow) {
          console.log('[webhook] no row matching subscription_id — ignoring:', subscription.id);
          break;
        }

        const payload = await buildWritePayload({
          userId: delRow.user_id,
          customerId: subscription.customer,
          subscription,
          isCompedOverride: delRow.is_comped,
        });
        const { error: deleteErr } = await supabaseAdmin
          .from('user_subscriptions')
          .update(payload)
          .eq('stripe_subscription_id', subscription.id);
        if (deleteErr) console.error('[webhook] delete update error:', deleteErr.message);
        else console.log('[webhook] cancel handled — keys:', Object.keys(payload).join(','));
        break;
      }

      default:
        console.log('[webhook] unhandled event type:', event.type, '— ignoring');
        break;
    }

    return res.status(200).json({ received: true });
  } catch (err) {
    console.error('[webhook] handler error:', err.message, err.stack);
    return res.status(500).json({ error: err.message });
  }
}

// Config must be set on the function BEFORE exporting — not after — to avoid
// module.exports reassignment destroying the property.
handler.config = { api: { bodyParser: false } };

module.exports = handler;

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
        const status = subscription.status;
        const periodEnd = subscription.current_period_end
          ? new Date(subscription.current_period_end * 1000).toISOString() : null;
        const trialEnd = subscription.trial_end
          ? new Date(subscription.trial_end * 1000).toISOString() : null;
        console.log('[webhook] subscription status:', status, '| trialEnd:', trialEnd, '| periodEnd:', periodEnd);

        // Skip update if user has a forever comp
        const { data: existingRow } = await supabaseAdmin
          .from('user_subscriptions')
          .select('is_comped')
          .eq('user_id', userId)
          .maybeSingle();
        if (existingRow?.is_comped) {
          console.log('[webhook] user is comped — skipping upsert for userId:', userId);
          break;
        }

        const { error: upsertErr } = await supabaseAdmin
          .from('user_subscriptions')
          .upsert(
            {
              user_id: userId,
              stripe_customer_id: customerId,
              stripe_subscription_id: subscriptionId,
              subscription_status: status,
              trial_ends_at: trialEnd,
              current_period_ends_at: periodEnd,
            },
            { onConflict: 'user_id' }
          );
        if (upsertErr) {
          console.error('[webhook] upsert FAILED — userId:', userId, '| error:', upsertErr.message);
          return res.status(500).json({ error: upsertErr.message });
        }
        console.log('[webhook] upsert SUCCESS — userId:', userId, '| status:', status, '| trialEnd:', trialEnd, '| periodEnd:', periodEnd);
        break;
      }

      case 'customer.subscription.updated': {
        const subscription = event.data.object;
        const periodEnd = subscription.current_period_end
          ? new Date(subscription.current_period_end * 1000).toISOString() : null;
        const trialEnd = subscription.trial_end
          ? new Date(subscription.trial_end * 1000).toISOString() : null;
        console.log('[webhook] subscription.updated — id:', subscription.id, '| status:', subscription.status);

        const { data: subRow } = await supabaseAdmin
          .from('user_subscriptions')
          .select('is_comped')
          .eq('stripe_subscription_id', subscription.id)
          .maybeSingle();
        if (subRow?.is_comped) {
          console.log('[webhook] user is comped — skipping update for subscription:', subscription.id);
          break;
        }

        const { error: updateErr } = await supabaseAdmin
          .from('user_subscriptions')
          .update({
            subscription_status: subscription.status,
            trial_ends_at: trialEnd,
            current_period_ends_at: periodEnd,
          })
          .eq('stripe_subscription_id', subscription.id);
        if (updateErr) console.error('[webhook] update error:', updateErr.message);
        else console.log('[webhook] updated subscription status:', subscription.status);
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object;
        console.log('[webhook] subscription.deleted — id:', subscription.id);

        const { data: delRow } = await supabaseAdmin
          .from('user_subscriptions')
          .select('is_comped')
          .eq('stripe_subscription_id', subscription.id)
          .maybeSingle();
        if (delRow?.is_comped) {
          console.log('[webhook] user is comped — skipping cancel for subscription:', subscription.id);
          break;
        }

        const { error: deleteErr } = await supabaseAdmin
          .from('user_subscriptions')
          .update({ subscription_status: 'canceled' })
          .eq('stripe_subscription_id', subscription.id);
        if (deleteErr) console.error('[webhook] delete update error:', deleteErr.message);
        else console.log('[webhook] marked subscription as canceled');
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

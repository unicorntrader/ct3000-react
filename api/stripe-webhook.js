const stripe = require('./lib/stripe');
const supabaseAdmin = require('./lib/supabaseAdmin');

// Vercel serverless: disable body parsing so we get the raw buffer for signature verification
module.exports.config = { api: { bodyParser: false } };

function getRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.setEncoding('utf8');
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const sig = req.headers['stripe-signature'];
  if (!sig) return res.status(400).json({ error: 'Missing stripe-signature header' });

  const rawBody = await getRawBody(req);

  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).json({ error: `Webhook Error: ${err.message}` });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const customerId = session.customer;
        const subscriptionId = session.subscription;

        // Retrieve subscription to get trial/active status and period end
        const subscription = await stripe.subscriptions.retrieve(subscriptionId);
        const status = subscription.status; // 'trialing' or 'active'
        const periodEnd = new Date(subscription.current_period_end * 1000).toISOString();

        await supabaseAdmin
          .from('user_subscriptions')
          .upsert(
            {
              stripe_customer_id: customerId,
              stripe_subscription_id: subscriptionId,
              subscription_status: status,
              current_period_ends_at: periodEnd,
            },
            { onConflict: 'stripe_customer_id' }
          );
        break;
      }

      case 'customer.subscription.updated': {
        const subscription = event.data.object;
        const periodEnd = new Date(subscription.current_period_end * 1000).toISOString();

        await supabaseAdmin
          .from('user_subscriptions')
          .update({
            subscription_status: subscription.status,
            current_period_ends_at: periodEnd,
          })
          .eq('stripe_subscription_id', subscription.id);
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object;

        await supabaseAdmin
          .from('user_subscriptions')
          .update({ subscription_status: 'canceled' })
          .eq('stripe_subscription_id', subscription.id);
        break;
      }

      default:
        // Ignore unhandled event types
        break;
    }

    return res.status(200).json({ received: true });
  } catch (err) {
    console.error('Webhook handler error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};

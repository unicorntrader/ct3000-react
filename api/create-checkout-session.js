const Stripe = require('stripe');
const { createClient } = require('@supabase/supabase-js');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const supabaseAdmin = createClient(
  process.env.REACT_APP_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const PRICE_ID = process.env.STRIPE_PRICE_ID || 'price_1TL652Au7jOW9xbVPjCEQLiP';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // 1. Extract Bearer token
  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing Authorization header' });
  }
  const token = authHeader.slice(7);

  // 2. Verify JWT — use service role client's auth.getUser which validates any JWT
  const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
  if (authError || !user) {
    console.log('[checkout] auth failed:', authError?.message);
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
  console.log('[checkout] authenticated userId:', user.id, 'email:', user.email);

  try {
    // 3. Create Stripe customer
    const customer = await stripe.customers.create({
      email: user.email,
      metadata: { supabase_user_id: user.id },
    });
    console.log('[checkout] created Stripe customer:', customer.id);

    // 4. Save pending row — establishes the user_id <-> stripe_customer_id link
    //    before the checkout session exists, so webhook fallback lookup works
    const { error: upsertError } = await supabaseAdmin
      .from('user_subscriptions')
      .upsert(
        {
          user_id: user.id,
          stripe_customer_id: customer.id,
          subscription_status: 'pending',
        },
        { onConflict: 'user_id' }
      );
    if (upsertError) {
      console.error('[checkout] DB upsert error:', upsertError.message);
      return res.status(500).json({ error: 'Failed to save subscription record' });
    }
    console.log('[checkout] saved pending row to user_subscriptions');

    // 5. Create Stripe Checkout Session
    const session = await stripe.checkout.sessions.create({
      customer: customer.id,
      mode: 'subscription',
      line_items: [{ price: PRICE_ID, quantity: 1 }],
      subscription_data: { trial_period_days: 7 },
      metadata: { supabase_user_id: user.id },
      success_url: 'https://ct3000-react.vercel.app?checkout=success',
      cancel_url: 'https://ct3000-react.vercel.app',
    });
    console.log('[checkout] created session:', session.id, '| url:', session.url);

    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('[checkout] error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};

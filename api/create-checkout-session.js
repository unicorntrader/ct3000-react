const stripe = require('./lib/stripe');
const supabaseAdmin = require('./lib/supabaseAdmin');
const { createClient } = require('@supabase/supabase-js');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Authenticate user from Authorization header
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header' });
  }
  const token = authHeader.slice(7);

  // Verify the JWT with Supabase
  const supabaseUrl = process.env.REACT_APP_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.REACT_APP_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const supabaseClient = createClient(supabaseUrl, supabaseAnonKey);

  const { data: { user }, error: authError } = await supabaseClient.auth.getUser(token);
  if (authError || !user) {
    return res.status(401).json({ error: 'Invalid token' });
  }

  try {
    // Create a Stripe customer with the user's email
    const customer = await stripe.customers.create({
      email: user.email,
      metadata: { supabase_user_id: user.id },
    });

    // Save the Stripe customer ID to user_subscriptions
    await supabaseAdmin
      .from('user_subscriptions')
      .upsert(
        { user_id: user.id, stripe_customer_id: customer.id },
        { onConflict: 'user_id' }
      );

    // Create the Checkout Session
    const session = await stripe.checkout.sessions.create({
      customer: customer.id,
      mode: 'subscription',
      line_items: [{ price: 'price_1TL652Au7jOW9xbVPjCEQLiP', quantity: 1 }],
      subscription_data: { trial_period_days: 7 },
      success_url: 'https://ct3000-react.vercel.app?session_id={CHECKOUT_SESSION_ID}',
      cancel_url: 'https://ct3000-react.vercel.app',
    });

    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('Checkout session error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};

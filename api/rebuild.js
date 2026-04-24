const { createClient } = require('@supabase/supabase-js');
const { rebuildForUser } = require('./_lib/rebuildForUser');
const { captureServerError } = require('./_lib/sentry');

const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || 'https://ct3000-react.vercel.app';

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing Authorization header' });
  }

  const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(authHeader.slice(7));
  if (authError || !user) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  const userId = user.id;

  try {
    const { count, warnings } = await rebuildForUser(userId, supabaseAdmin);
    console.log(`[rebuild] userId=${userId} — inserted ${count} logical trades`);
    return res.status(200).json({ success: true, count, warnings });
  } catch (err) {
    console.error('[rebuild] failed:', err?.message || err);
    await captureServerError(err, { userId, route: 'rebuild' });
    return res.status(500).json({ success: false, error: err?.message || 'Rebuild failed' });
  }
};

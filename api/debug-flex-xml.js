const https = require('https');
const { createClient } = require('@supabase/supabase-js');

const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || 'https://ct3000-react.vercel.app';
const BASE_URL = 'https://gdcdyn.interactivebrokers.com/Universal/servlet';
const SEND_URL = `${BASE_URL}/FlexStatementService.SendRequest`;
const GET_URL  = `${BASE_URL}/FlexStatementService.GetStatement`;

// Single-tenant debug endpoint. Returns the raw Flex XML IBKR hands us,
// for ad-hoc "is my latest trade in there yet?" inspection. Gated to one
// email — do not loosen without review.
const ALLOWED_EMAIL = 'antonis@protopapas.net';

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
      res.on('error', reject);
    }).on('error', reject);
  });
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function sendRequest(token, queryId) {
  const url = `${SEND_URL}?t=${token}&q=${queryId}&v=3`;
  const xml = await httpsGet(url);
  const ref = xml.match(/<ReferenceCode>(\d+)<\/ReferenceCode>/)?.[1];
  if (!ref) throw new Error(`No ReferenceCode. Response: ${xml.slice(0, 300)}`);
  return ref;
}

async function getStatement(refCode, token, maxRetries = 10, waitMs = 3000) {
  const url = `${GET_URL}?q=${refCode}&t=${token}&v=3`;
  for (let i = 0; i < maxRetries; i++) {
    const xml = await httpsGet(url);
    if (xml.includes('<FlexQueryResponse') || xml.includes('<FlexStatement ')) return xml;
    if (xml.includes('<FlexStatementResponse')) {
      const status = xml.match(/<Status>([^<]+)<\/Status>/)?.[1];
      if (status && status !== 'Warn') throw new Error(`IBKR status=${status}: ${xml.slice(0, 300)}`);
      await sleep(waitMs);
      continue;
    }
    throw new Error(`Unexpected: ${xml.slice(0, 300)}`);
  }
  throw new Error(`Timed out after ${(maxRetries * waitMs) / 1000}s`);
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) return res.status(401).json({ error: 'Missing Authorization' });
  const jwt = authHeader.slice(7);

  const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(jwt);
  if (authError || !user) return res.status(401).json({ error: 'Invalid token' });
  if (user.email !== ALLOWED_EMAIL) return res.status(403).json({ error: 'Forbidden' });

  const { data: creds, error: credsError } = await supabaseAdmin
    .from('user_ibkr_credentials')
    .select('ibkr_token, query_id_30d')
    .eq('user_id', user.id)
    .single();
  if (credsError || !creds?.ibkr_token || !creds?.query_id_30d) {
    return res.status(400).json({ error: 'No IBKR credentials on file' });
  }

  try {
    const refCode = await sendRequest(creds.ibkr_token, creds.query_id_30d);
    const xml = await getStatement(refCode, creds.ibkr_token);
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    return res.status(200).send(xml);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

const https = require('https');
const { createClient } = require('@supabase/supabase-js');

const BASE_URL = 'https://gdcdyn.interactivebrokers.com/AccountManagement/FlexWebService';
const SEND_URL = `${BASE_URL}/SendRequest`;
const GET_URL  = `${BASE_URL}/GetStatement`;

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

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function sendRequest(token, queryId) {
  const url = `${SEND_URL}?t=${token}&q=${queryId}&v=3`;
  const xml = await httpsGet(url);
  const refMatch = xml.match(/<ReferenceCode>(\d+)<\/ReferenceCode>/);
  const statusMatch = xml.match(/<Status>([^<]+)<\/Status>/);
  if (!refMatch) {
    throw new Error(`SendRequest failed. Status: ${statusMatch?.[1] || 'unknown'}. Response: ${xml.substring(0, 300)}`);
  }
  return refMatch[1];
}

async function getStatement(refCode, maxRetries = 8, waitMs = 3000) {
  const url = `${GET_URL}?q=${refCode}&v=3`;
  for (let i = 0; i < maxRetries; i++) {
    const xml = await httpsGet(url);
    if (xml.includes('<FlexStatementResponse>')) {
      await sleep(waitMs);
      continue;
    }
    if (xml.includes('<FlexQueryResponse') || xml.includes('<FlexStatement ')) {
      return xml;
    }
    throw new Error(`GetStatement error on attempt ${i + 1}: ${xml.substring(0, 300)}`);
  }
  throw new Error('Timed out waiting for IBKR statement after ' + maxRetries + ' attempts');
}

function parseTrades(xml) {
  const trades = [];
  const tradeRegex = /<Trade\s([^>]+)\/>/g;
  let match;
  while ((match = tradeRegex.exec(xml)) !== null) {
    const attrs = match[1];
    const get = (field) => {
      const m = attrs.match(new RegExp(`${field}="([^"]*)"`));
      return m ? m[1] : null;
    };
    trades.push({
      ibExecID:             get('ibExecID'),
      ibOrderID:            get('ibOrderID'),
      accountId:            get('accountId'),
      conid:                get('conid'),
      symbol:               get('symbol'),
      assetCategory:        get('assetCategory'),
      buySell:              get('buySell'),
      openCloseIndicator:   get('openCloseIndicator'),
      quantity:             get('quantity'),
      tradePrice:           get('tradePrice'),
      dateTime:             get('dateTime'),
      netCash:              get('netCash'),
      fifoPnlRealized:      get('fifoPnlRealized'),
      ibCommission:         get('ibCommission'),
      ibCommissionCurrency: get('ibCommissionCurrency'),
      currency:             get('currency'),
      transactionType:      get('transactionType'),
      notes:                get('notes'),
      multiplier:           get('multiplier'),
      strike:               get('strike'),
      expiry:               get('expiry'),
      putCall:              get('putCall'),
    });
  }
  return trades;
}

function parseOpenPositions(xml) {
  const positions = [];
  const posRegex = /<OpenPosition\s([^>]+)\/>/g;
  let match;
  while ((match = posRegex.exec(xml)) !== null) {
    const attrs = match[1];
    const get = (field) => {
      const m = attrs.match(new RegExp(`${field}="([^"]*)"`));
      return m ? m[1] : null;
    };
    positions.push({
      accountId:     get('accountId'),
      conid:         get('conid'),
      symbol:        get('symbol'),
      assetCategory: get('assetCategory'),
      position:      get('position'),
      avgCost:       get('avgCost') || get('openPrice'),
      marketValue:   get('marketValue') || get('positionValue'),
      unrealizedPnl: get('unrealizedPnl') || get('fifoPnlUnrealized'),
      currency:      get('currency'),
    });
  }
  return positions;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-user-id');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  let token, queryId, userId;

  // If called with explicit query params (test mode), use those directly
  if (req.query.token && req.query.queryId) {
    token = req.query.token;
    queryId = req.query.queryId;
  } else {
    // Otherwise look up credentials from DB using user_id header
    userId = req.headers['x-user-id'];
    if (!userId) {
      return res.status(400).json({ error: 'Missing x-user-id header or token/queryId params.' });
    }

    const supabaseUrl = process.env.REACT_APP_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
      return res.status(500).json({ error: 'Supabase env vars not configured on server.' });
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const { data, error } = await supabase
      .from('user_ibkr_credentials')
      .select('ibkr_token, query_id_30d')
      .eq('user_id', userId)
      .single();

    if (error || !data) {
      return res.status(404).json({ error: 'No IBKR credentials found for this user. Please connect IBKR first.' });
    }

    token = data.ibkr_token;
    queryId = data.query_id_30d;
  }

  if (!token || !queryId) {
    return res.status(400).json({ error: 'Missing IBKR token or query ID.' });
  }

  try {
    console.log('Step 1: Sending request to IBKR...');
    const refCode = await sendRequest(token, queryId);
    console.log('Reference code:', refCode);

    console.log('Step 2: Fetching statement...');
    const xml = await getStatement(refCode);
    console.log('XML length:', xml.length);

    console.log('Step 3: Parsing trades...');
    const trades = parseTrades(xml);
    const openPositions = parseOpenPositions(xml);

    console.log(`Parsed ${trades.length} trades, ${openPositions.length} open positions`);

    return res.status(200).json({
      success: true,
      tradeCount: trades.length,
      openPositionCount: openPositions.length,
      trades,
      openPositions,
    });

  } catch (err) {
    console.error('Sync error:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
};

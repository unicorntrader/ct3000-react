// Vercel serverless function
// Endpoint: /api/sync
// Fetches trades from IBKR Flex Web Service and returns parsed JSON
//
// Usage:
//   GET /api/sync?token=YOUR_TOKEN&queryId=YOUR_QUERY_ID
//   OR set IBKR_TOKEN and IBKR_QUERY_ID in Vercel environment variables

const https = require('https');

const BASE_URL = 'https://gdcdyn.interactivebrokers.com/AccountManagement/FlexWebService';
const SEND_URL = `${BASE_URL}/SendRequest`;
const GET_URL  = `${BASE_URL}/GetStatement`;

// Simple HTTPS GET that returns the response body as a string
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

// Sleep helper for polling
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Step 1: Send request, get reference code
async function sendRequest(token, queryId) {
  const url = `${SEND_URL}?t=${token}&q=${queryId}&v=3`;
  const xml = await httpsGet(url);

  // Parse reference code from XML like:
  // <FlexStatementResponse><Status>Success</Status><ReferenceCode>1234567890</ReferenceCode>...
  const refMatch = xml.match(/<ReferenceCode>(\d+)<\/ReferenceCode>/);
  const statusMatch = xml.match(/<Status>([^<]+)<\/Status>/);

  if (!refMatch) {
    throw new Error(`SendRequest failed. Status: ${statusMatch?.[1] || 'unknown'}. Response: ${xml.substring(0, 300)}`);
  }

  return refMatch[1];
}

// Step 2: Poll GetStatement until ready
async function getStatement(refCode, maxRetries = 8, waitMs = 3000) {
  const url = `${GET_URL}?q=${refCode}&v=3`;

  for (let i = 0; i < maxRetries; i++) {
    const xml = await httpsGet(url);

    // If still generating, IBKR returns a FlexStatementResponse with Status
    if (xml.includes('<FlexStatementResponse>')) {
      const statusMatch = xml.match(/<Status>([^<]+)<\/Status>/);
      const status = statusMatch?.[1];
      if (status === 'Success' || status === 'Complete') {
        // Sometimes success but no data yet — wait
        await sleep(waitMs);
        continue;
      }
      // Still processing
      await sleep(waitMs);
      continue;
    }

    // Got actual statement XML
    if (xml.includes('<FlexQueryResponse') || xml.includes('<FlexStatement ')) {
      return xml;
    }

    // Error response
    throw new Error(`GetStatement error on attempt ${i + 1}: ${xml.substring(0, 300)}`);
  }

  throw new Error('Timed out waiting for IBKR statement after ' + maxRetries + ' attempts');
}

// Parse trades from XML — extracts the 21 fields we need
function parseTrades(xml) {
  const trades = [];
  const tradeRegex = /<Trade\s([^>]+)\/>/g;
  let match;

  while ((match = tradeRegex.exec(xml)) !== null) {
    const attrs = match[1];

    const get = (field) => {
      const m = attrs.match(new RegExp(`${field}="([^"]*)"`) );
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

// Parse open positions from XML
function parseOpenPositions(xml) {
  const positions = [];
  const posRegex = /<OpenPosition\s([^>]+)\/>/g;
  let match;

  while ((match = posRegex.exec(xml)) !== null) {
    const attrs = match[1];
    const get = (field) => {
      const m = attrs.match(new RegExp(`${field}="([^"]*)"`) );
      return m ? m[1] : null;
    };

    positions.push({
      accountId:      get('accountId'),
      conid:          get('conid'),
      symbol:         get('symbol'),
      assetCategory:  get('assetCategory'),
      position:       get('position'),
      avgCost:        get('avgCost') || get('openPrice'),
      marketValue:    get('marketValue') || get('positionValue'),
      unrealizedPnl:  get('unrealizedPnl') || get('fifoPnlUnrealized'),
      currency:       get('currency'),
    });
  }

  return positions;
}

// Main handler
module.exports = async function handler(req, res) {
  // CORS headers so the React app can call this
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Get credentials: query params first, then env vars
  const token   = req.query.token   || process.env.IBKR_TOKEN;
  const queryId = req.query.queryId || process.env.IBKR_QUERY_ID;

  if (!token || !queryId) {
    return res.status(400).json({
      error: 'Missing credentials. Pass ?token=XXX&queryId=YYY or set IBKR_TOKEN and IBKR_QUERY_ID env vars.'
    });
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
      // Include raw XML length for debugging — remove in production
      xmlLength: xml.length,
    });

  } catch (err) {
    console.error('Sync error:', err.message);
    return res.status(500).json({
      success: false,
      error: err.message,
    });
  }
};

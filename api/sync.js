const https = require('https');

const BASE_URL = 'https://gdcdyn.interactivebrokers.com/Universal/servlet';
const SEND_URL = `${BASE_URL}/FlexStatementService.SendRequest`;
const GET_URL  = `${BASE_URL}/FlexStatementService.GetStatement`;

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

async function getStatement(refCode, token, maxRetries = 10, waitMs = 3000) {
  const url = `${GET_URL}?q=${refCode}&t=${token}&v=3`;

  for (let i = 0; i < maxRetries; i++) {
    const xml = await httpsGet(url);

    // IBKR returns FlexStatementResponse while processing OR when done
    if (xml.includes('<FlexStatementResponse')) {
      const statusMatch = xml.match(/<Status>([^<]+)<\/Status>/);
      const status = statusMatch?.[1];

      if (status === 'Success' || status === 'Complete') {
        // Data is embedded inside this response — return it
        return xml;
      }

      // Still processing — wait and retry
      console.log(`Attempt ${i + 1}: Status=${status}, waiting...`);
      await sleep(waitMs);
      continue;
    }

    // Direct FlexQueryResponse — also valid
    if (xml.includes('<FlexQueryResponse') || xml.includes('<FlexStatement ')) {
      return xml;
    }

    throw new Error(`Unexpected response on attempt ${i + 1}: ${xml.substring(0, 300)}`);
  }

  throw new Error('Timed out waiting for IBKR statement after ' + maxRetries + ' attempts');
}

function parseBaseCurrency(xml) {
  // baseCurrency is an attribute on <FlexStatement ...> e.g. baseCurrency="USD"
  const m = xml.match(/<FlexStatement[^>]+baseCurrency="([^"]+)"/);
  return m ? m[1] : null;
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
      fxRateToBase:         get('fxRateToBase'),
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
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const token   = req.query.token;
  const queryId = req.query.queryId;

  if (!token || !queryId) {
    return res.status(400).json({ error: 'Missing token or queryId params.' });
  }

  try {
    console.log('Step 1: Sending request to IBKR...');
    const refCode = await sendRequest(token, queryId);
    console.log('Reference code:', refCode);

    console.log('Step 2: Fetching statement...');
    const xml = await getStatement(refCode, token);
    console.log('XML length:', xml.length);

    console.log('Step 3: Parsing...');
    const trades = parseTrades(xml);
    const openPositions = parseOpenPositions(xml);
    const baseCurrency = parseBaseCurrency(xml);

    // Debug: show the FlexStatement opening tag so we can verify regex match
    const flexStatementSnippet = xml.match(/<FlexStatement[^>]{0,200}/)?.[0] || 'NO <FlexStatement> TAG FOUND';
    console.log('[sync] FlexStatement snippet:', flexStatementSnippet);
    console.log(`[sync] Parsed ${trades.length} trades, ${openPositions.length} open positions, baseCurrency=${baseCurrency}`);

    return res.status(200).json({
      success: true,
      tradeCount: trades.length,
      openPositionCount: openPositions.length,
      trades,
      openPositions,
      baseCurrency,
    });

  } catch (err) {
    console.error('Sync error:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
};

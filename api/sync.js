const https = require('https');
const { XMLParser } = require('fast-xml-parser');

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

    if (xml.includes('<FlexStatementResponse')) {
      const statusMatch = xml.match(/<Status>([^<]+)<\/Status>/);
      const status = statusMatch?.[1];

      if (status === 'Success' || status === 'Complete') {
        return xml;
      }

      console.log(`Attempt ${i + 1}: Status=${status}, waiting...`);
      await sleep(waitMs);
      continue;
    }

    if (xml.includes('<FlexQueryResponse') || xml.includes('<FlexStatement ')) {
      return xml;
    }

    throw new Error(`Unexpected response on attempt ${i + 1}: ${xml.substring(0, 300)}`);
  }

  throw new Error('Timed out waiting for IBKR statement after ' + maxRetries + ' attempts');
}

// ── XML parser ────────────────────────────────────────────────────────────────
const xmlParser = new XMLParser({
  ignoreAttributes:    false,
  attributeNamePrefix: '',
  isArray: (name) => name === 'Trade' || name === 'OpenPosition',
  parseAttributeValue: false, // keep all values as strings — matches regex behaviour
  trimValues:          true,
});

// Depth-first search for all nodes with a given tag name (handles any IBKR nesting)
function collectNodes(obj, tagName) {
  const results = [];
  if (!obj || typeof obj !== 'object') return results;
  for (const [key, val] of Object.entries(obj)) {
    if (key === tagName) {
      const arr = Array.isArray(val) ? val : [val];
      results.push(...arr.filter(v => v && typeof v === 'object'));
    } else {
      results.push(...collectNodes(val, tagName));
    }
  }
  return results;
}

function parseTrades(parsed) {
  return collectNodes(parsed, 'Trade').map(t => ({
    ibExecID:             t.ibExecID             ?? null,
    ibOrderID:            t.ibOrderID            ?? null,
    accountId:            t.accountId            ?? null,
    conid:                t.conid                ?? null,
    symbol:               t.symbol               ?? null,
    assetCategory:        t.assetCategory        ?? null,
    buySell:              t.buySell              ?? null,
    openCloseIndicator:   t.openCloseIndicator   ?? null,
    quantity:             t.quantity             ?? null,
    tradePrice:           t.tradePrice           ?? null,
    dateTime:             t.dateTime             ?? null,
    netCash:              t.netCash              ?? null,
    fifoPnlRealized:      t.fifoPnlRealized      ?? null,
    ibCommission:         t.ibCommission         ?? null,
    ibCommissionCurrency: t.ibCommissionCurrency ?? null,
    currency:             t.currency             ?? null,
    fxRateToBase:         t.fxRateToBase         ?? null,
    transactionType:      t.transactionType      ?? null,
    notes:                t.notes                ?? null,
    multiplier:           t.multiplier           ?? null,
    strike:               t.strike               ?? null,
    expiry:               t.expiry               ?? null,
    putCall:              t.putCall              ?? null,
  }));
}

function parseOpenPositions(parsed) {
  return collectNodes(parsed, 'OpenPosition').map(p => ({
    accountId:     p.accountId                          ?? null,
    conid:         p.conid                              ?? null,
    symbol:        p.symbol                             ?? null,
    assetCategory: p.assetCategory                      ?? null,
    position:      p.position                           ?? null,
    avgCost:       p.avgCost      ?? p.openPrice        ?? null,
    marketValue:   p.marketValue  ?? p.positionValue    ?? null,
    unrealizedPnl: p.unrealizedPnl ?? p.fifoPnlUnrealized ?? null,
    currency:      p.currency                           ?? null,
  }));
}

function parseBaseCurrency(parsed) {
  const acctInfo = collectNodes(parsed, 'AccountInformation')[0];
  return acctInfo?.currency ?? null;
}

// ── Handler ───────────────────────────────────────────────────────────────────
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
    let parsed;
    try {
      parsed = xmlParser.parse(xml);
    } catch (parseErr) {
      console.error('XML parse error:', parseErr.message);
      return res.status(422).json({ success: false, error: 'Failed to parse IBKR response — the data format may have changed' });
    }

    const trades        = parseTrades(parsed);
    const openPositions = parseOpenPositions(parsed);
    const baseCurrency  = parseBaseCurrency(parsed);

    // Debug: log AccountInformation for verification
    const acctInfo = collectNodes(parsed, 'AccountInformation')[0];
    console.log('[sync] AccountInformation:', JSON.stringify(acctInfo ?? 'NOT FOUND'));
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

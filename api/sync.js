const https = require('https');
const { createClient } = require('@supabase/supabase-js');
const { captureServerError } = require('./lib/sentry');

const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || 'https://ct3000-react.vercel.app';
const BASE_URL = 'https://gdcdyn.interactivebrokers.com/Universal/servlet';
const SEND_URL = `${BASE_URL}/FlexStatementService.SendRequest`;
const GET_URL  = `${BASE_URL}/FlexStatementService.GetStatement`;

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

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Extract a human-readable error from an IBKR Flex failure payload.
// IBKR returns <Status>Fail</Status> + <ErrorCode> + <ErrorMessage> on errors.
function extractIBKRError(xml) {
  const status = xml.match(/<Status>([^<]+)<\/Status>/)?.[1] || 'unknown';
  const errorCode = xml.match(/<ErrorCode>([^<]+)<\/ErrorCode>/)?.[1];
  const errorMessage = xml.match(/<ErrorMessage>([^<]+)<\/ErrorMessage>/)?.[1];
  const parts = [`IBKR returned status=${status}`];
  if (errorCode) parts.push(`[${errorCode}]`);
  if (errorMessage) parts.push(errorMessage);
  return parts.join(' ');
}

async function sendRequest(token, queryId) {
  const url = `${SEND_URL}?t=${token}&q=${queryId}&v=3`;
  const xml = await httpsGet(url);
  const status = xml.match(/<Status>([^<]+)<\/Status>/)?.[1];
  if (status && status !== 'Success') {
    throw new Error(extractIBKRError(xml));
  }
  const refMatch = xml.match(/<ReferenceCode>(\d+)<\/ReferenceCode>/);
  if (!refMatch) {
    throw new Error(`IBKR sendRequest returned no ReferenceCode. Status=${status || 'unknown'}. Response snippet: ${xml.substring(0, 300)}`);
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

      // Non-success response with Warn status = still processing; keep polling.
      // Any other status (Fail, etc.) is terminal -- surface it immediately.
      if (status && status !== 'Warn') {
        throw new Error(extractIBKRError(xml));
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

  throw new Error(`Timed out waiting for IBKR statement after ${maxRetries} attempts (${(maxRetries * waitMs) / 1000}s)`);
}

function parseBaseCurrency(xml) {
  const m = xml.match(/<AccountInformation[^>]+currency="([^"]+)"/);
  return m ? m[1] : null;
}

// Read the Flex Query's configured window from the <FlexStatement> header.
// IBKR emits e.g. <FlexStatement accountId="..." fromDate="20260318" toDate="20260418" ...>
// Returns { fromDate, toDate, days } or null if the attributes aren't present.
// Used to reject queries wider than our product contract (30 days) up front
// with a clear error, instead of silently filtering trades after the fact.
function parseFlexPeriod(xml) {
  const stmt = xml.match(/<FlexStatement\s[^>]+>/);
  if (!stmt) return null;
  const header = stmt[0];
  const from = header.match(/fromDate="(\d{8})"/)?.[1];
  const to = header.match(/toDate="(\d{8})"/)?.[1];
  if (!from || !to) return null;
  const isoFrom = `${from.slice(0,4)}-${from.slice(4,6)}-${from.slice(6,8)}`;
  const isoTo = `${to.slice(0,4)}-${to.slice(4,6)}-${to.slice(6,8)}`;
  const days = Math.round((new Date(isoTo).getTime() - new Date(isoFrom).getTime()) / (24 * 60 * 60 * 1000));
  return { fromDate: isoFrom, toDate: isoTo, days };
}

// IBKR emits trade timestamps in a compact "YYYYMMDD;HHMMSS" format.
// Convert to 19-char ISO "YYYY-MM-DDTHH:MM:SS" here at parse time so:
//   - downstream code (builders, UI) deals in one format, not two
//   - trades.date_time is ready to be migrated from varchar(20) to timestamptz
//     without breaking old rows
// 19 chars fits the current varchar(20) column; the USING clause on the
// migration will coerce any historical rows still in IBKR compact format.
function ibkrDateToIso(dt) {
  if (!dt) return null;
  const [date, time] = dt.split(';');
  if (!date || date.length < 8) return null;
  const d = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;
  const t = (time && time.length >= 6)
    ? `${time.slice(0, 2)}:${time.slice(2, 4)}:${time.slice(4, 6)}`
    : '00:00:00';
  return `${d}T${t}`;
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
      dateTime:             ibkrDateToIso(get('dateTime')),
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
      fxRateToBase:  get('fxRateToBase'),
    });
  }
  return positions;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  console.log('[sync] method:', req.method, '| origin:', req.headers.origin, '| host:', req.headers.host);

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: `Method not allowed: ${req.method}` });

  // Authenticate the request
  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing Authorization header' });
  }
  const jwt = authHeader.slice(7);

  const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(jwt);
  if (authError || !user) {
    console.log('[sync] auth failed:', authError?.message);
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  // Resolve IBKR credentials:
  // - Test mode: token + queryId supplied in request body (before they are saved)
  // - Normal sync: look up from DB server-side (token never sent to client)
  let token, queryId;
  const body = req.body || {};

  if (body.token && body.queryId) {
    token = body.token;
    queryId = body.queryId;
  } else {
    const { data: creds, error: credsError } = await supabaseAdmin
      .from('user_ibkr_credentials')
      .select('ibkr_token, query_id_30d')
      .eq('user_id', user.id)
      .single();

    if (credsError || !creds) {
      return res.status(400).json({ error: 'No IBKR credentials found. Please connect your account first.' });
    }
    token = creds.ibkr_token;
    queryId = creds.query_id_30d;
  }

  if (!token || !queryId) {
    return res.status(400).json({ error: 'Missing token or queryId.' });
  }

  try {
    console.log('[sync] Step 1: Sending request to IBKR for user:', user.id);
    const refCode = await sendRequest(token, queryId);
    console.log('[sync] Reference code:', refCode);

    console.log('[sync] Step 2: Fetching statement...');
    const xml = await getStatement(refCode, token);
    console.log('[sync] XML length:', xml.length);

    console.log('[sync] Step 3: Parsing...');

    // Our product contract is a rolling 30-day sync. Read fromDate/toDate
    // from the <FlexStatement> header and reject anything wider. Buffer of
    // 5 days accounts for IBKR's inclusive/exclusive counting — a correctly
    // configured "Last 30 Calendar Days" query reports 30-31 days. If the
    // header is missing we reject too: we'd rather fail loud than ship bad
    // data on a silently-broken parser.
    const MAX_PERIOD_DAYS = 35;
    const period = parseFlexPeriod(xml);
    if (!period) {
      // SUPPORT EMAIL: update when support@cotraderapp.com mailbox is live.
      const msg = 'Could not read the Flex Query window from IBKR\'s response (no fromDate/toDate on the <FlexStatement> header). ' +
        'This usually means an unexpected XML format — please email thinker@philoinvestor.com with your Flex Query ID.';
      console.log('[sync] rejected: could not parse Flex period from header');
      return res.status(400).json({ success: false, error: msg });
    }
    if (period.days > MAX_PERIOD_DAYS) {
      const msg = `Your IBKR Flex Query covers ${period.days} days (${period.fromDate} → ${period.toDate}). ` +
        `CT3000 syncs a rolling 30-day window. Please reconfigure your Flex Query in IBKR to ` +
        `"Last 30 Calendar Days" (Flex Queries → edit → Period) and sync again.`;
      console.log('[sync] rejected: flex period too long —', period.days, 'days');
      return res.status(400).json({ success: false, error: msg, flexPeriodDays: period.days });
    }
    console.log(`[sync] Flex period: ${period.fromDate} → ${period.toDate} (${period.days} days)`);

    const trades = parseTrades(xml);
    const openPositions = parseOpenPositions(xml);
    const baseCurrency = parseBaseCurrency(xml);

    const acctInfoSnippet = xml.match(/<AccountInformation[^>]{0,200}/)?.[0] || 'NO <AccountInformation> TAG FOUND';
    console.log('[sync] AccountInformation snippet:', acctInfoSnippet);
    console.log(`[sync] Parsed ${trades.length} trades, ${openPositions.length} open positions, baseCurrency=${baseCurrency}`);

    // Clear demo data and mark ibkr_connected before returning
    const [ltDel, posDel, planDel, pbDel] = await Promise.all([
      supabaseAdmin.from('logical_trades').delete().eq('user_id', user.id).eq('is_demo', true),
      supabaseAdmin.from('open_positions').delete().eq('user_id', user.id).eq('is_demo', true),
      supabaseAdmin.from('planned_trades').delete().eq('user_id', user.id).eq('is_demo', true),
      supabaseAdmin.from('playbooks').delete().eq('user_id', user.id).eq('is_demo', true),
    ]);
    await supabaseAdmin
      .from('user_subscriptions')
      .update({ ibkr_connected: true })
      .eq('user_id', user.id);

    const demoCleared = ![ltDel, posDel, planDel, pbDel].some(r => r.error);
    console.log('[sync] demo rows cleared, ibkr_connected set');

    return res.status(200).json({
      success: true,
      tradeCount: trades.length,
      openPositionCount: openPositions.length,
      trades,
      openPositions,
      baseCurrency,
      demoCleared,
    });

  } catch (err) {
    console.error('[sync] error:', err.message);
    await captureServerError(err, { userId: user?.id, route: 'sync' });
    return res.status(500).json({ success: false, error: err.message });
  }
};

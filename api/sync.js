const https = require('https');
const { createClient } = require('@supabase/supabase-js');
const { captureServerError } = require('./_lib/sentry');
const { requireActiveSubscription } = require('./_lib/requireActiveSubscription');
const { performUserSync } = require('./_lib/performUserSync');

// /api/sync is now a thin HTTP wrapper around performUserSync -- the same
// shared core the nightly cron uses. All IBKR fetch, parse, persistence,
// demo cleanup, credential update, and logical-trade rebuild happen
// server-side in one flow. The browser receives only a summary
// (counts + warnings + base currency), never raw trades to persist.
//
// Why it changed: the previous version returned trades/positions to the
// browser, which then did its own upserts/deletes. A client crash, network
// blip, or tab close between the 200 OK and the final DB write left the
// user with partial state (credentials updated, demo cleared, but no
// trades). The refactor makes the unit of work atomic: either the server
// finishes everything or it reports failure.
//
// Test mode path (token + queryId in the body) is preserved -- during
// initial IBKR connect, the user hasn't saved creds yet and we want to
// verify them end-to-end before persisting. That path still fetches and
// parses but does NOT persist; it returns the counts so the UI can show
// "Connection works! N trades found".

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

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

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
  if (status && status !== 'Success') throw new Error(extractIBKRError(xml));
  const refMatch = xml.match(/<ReferenceCode>(\d+)<\/ReferenceCode>/);
  if (!refMatch) throw new Error(`IBKR sendRequest returned no ReferenceCode. Status=${status || 'unknown'}. Snippet: ${xml.substring(0, 300)}`);
  return refMatch[1];
}

async function getStatement(refCode, token, maxRetries = 10, waitMs = 3000) {
  const url = `${GET_URL}?q=${refCode}&t=${token}&v=3`;
  for (let i = 0; i < maxRetries; i++) {
    const xml = await httpsGet(url);
    if (xml.includes('<FlexStatementResponse')) {
      const status = xml.match(/<Status>([^<]+)<\/Status>/)?.[1];
      if (status === 'Success' || status === 'Complete') return xml;
      if (status && status !== 'Warn') throw new Error(extractIBKRError(xml));
      await sleep(waitMs);
      continue;
    }
    if (xml.includes('<FlexQueryResponse') || xml.includes('<FlexStatement ')) return xml;
    throw new Error(`Unexpected response on attempt ${i + 1}: ${xml.substring(0, 300)}`);
  }
  throw new Error(`Timed out waiting for IBKR statement after ${maxRetries} attempts (${(maxRetries * waitMs) / 1000}s)`);
}

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

// Count trades + positions in the XML for the test-mode response without
// replicating the full parser. Matches the regex shape performUserSync
// uses so counts agree across paths.
function countEntities(xml) {
  const tradeCount = (xml.match(/<Trade\s[^>]+\/>/g) || []).length;
  const positionCount = (xml.match(/<OpenPosition\s[^>]+\/>/g) || []).length;
  const baseCurrency = xml.match(/<AccountInformation[^>]+currency="([^"]+)"/)?.[1] || null;
  return { tradeCount, positionCount, baseCurrency };
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

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

  // Paywall gate. App.jsx blocks the UI for inactive subscriptions, but a
  // direct POST here with a still-valid JWT would bypass that. Mirror the
  // isActive() logic server-side.
  const sub = await requireActiveSubscription(user.id, supabaseAdmin);
  if (!sub.ok) {
    console.log('[sync] blocked — subscription:', sub.reason, 'userId:', user.id);
    return res.status(402).json({ success: false, error: sub.reason });
  }

  const body = req.body || {};
  const isTestMode = !!(body.token && body.queryId);

  try {
    // ── Test mode: verify user-supplied credentials against IBKR without
    //    persisting. Used during initial connect -- the UI hasn't stored
    //    the token in user_ibkr_credentials yet.
    if (isTestMode) {
      console.log('[sync] test mode — userId:', user.id);
      const refCode = await sendRequest(body.token, body.queryId);
      const xml = await getStatement(refCode, body.token);

      const MAX_PERIOD_DAYS = 35;
      const period = parseFlexPeriod(xml);
      if (!period) {
        return res.status(400).json({
          success: false,
          error: 'Could not read the Flex Query window from IBKRs response (no fromDate/toDate on the <FlexStatement> header). Please email support with your Flex Query ID.',
        });
      }
      if (period.days > MAX_PERIOD_DAYS) {
        return res.status(400).json({
          success: false,
          error: `Your IBKR Flex Query covers ${period.days} days (${period.fromDate} → ${period.toDate}). CT3000 syncs a rolling 30-day window. Please reconfigure your Flex Query to "Last 30 Calendar Days" and sync again.`,
          flexPeriodDays: period.days,
        });
      }
      const counts = countEntities(xml);
      return res.status(200).json({
        success: true,
        mode: 'test',
        tradeCount: counts.tradeCount,
        openPositionCount: counts.positionCount,
        baseCurrency: counts.baseCurrency,
      });
    }

    // ── Normal sync: server-authoritative. performUserSync reads the stored
    //    IBKR credentials via service_role, fetches Flex, parses, upserts
    //    trades, replaces open_positions, clears demo rows, sets
    //    ibkr_connected, updates last_sync_at, and rebuilds logical_trades.
    //    Everything happens server-side; a browser disconnect after the
    //    response does not leave the DB half-written.
    console.log('[sync] normal sync — userId:', user.id);
    const result = await performUserSync(user.id, supabaseAdmin);
    return res.status(200).json({
      success: true,
      mode: 'sync',
      tradeCount: result.tradeCount,
      openPositionCount: result.positionCount,
      logicalCount: result.logicalCount,
      rebuildWarnings: result.rebuildWarnings || [],
    });
  } catch (err) {
    console.error('[sync] error:', err.message);
    await captureServerError(err, { userId: user?.id, route: 'sync', mode: isTestMode ? 'test' : 'sync' });
    // Record failure state for the UI to surface on non-test flows. Test
    // mode fails loudly but doesn't dirty the credentials row.
    if (!isTestMode && user?.id) {
      await supabaseAdmin
        .from('user_ibkr_credentials')
        .update({
          last_sync_error: (err.message || '').slice(0, 500),
          last_sync_failed_at: new Date().toISOString(),
        })
        .eq('user_id', user.id);
    }
    return res.status(500).json({ success: false, error: err.message });
  }
};

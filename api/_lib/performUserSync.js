'use strict';

const https = require('https');
const { rebuildForUser } = require('./rebuildForUser');

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

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function extractIBKRError(xml) {
  const status = xml.match(/<Status>([^<]+)<\/Status>/)?.[1] || 'unknown';
  const errorCode = xml.match(/<ErrorCode>([^<]+)<\/ErrorCode>/)?.[1];
  const errorMessage = xml.match(/<ErrorMessage>([^<]+)<\/ErrorMessage>/)?.[1];
  const parts = [`IBKR status=${status}`];
  if (errorCode) parts.push(`[${errorCode}]`);
  if (errorMessage) parts.push(errorMessage);
  return parts.join(' ');
}

async function sendRequest(token, queryId) {
  const url = `${SEND_URL}?t=${token}&q=${queryId}&v=3`;
  const xml = await httpsGet(url);
  const status = xml.match(/<Status>([^<]+)<\/Status>/)?.[1];
  if (status && status !== 'Success') throw new Error(extractIBKRError(xml));
  const ref = xml.match(/<ReferenceCode>(\d+)<\/ReferenceCode>/)?.[1];
  if (!ref) throw new Error(`No ReferenceCode. Status=${status}. Snippet: ${xml.slice(0, 300)}`);
  return ref;
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
    throw new Error(`Unexpected IBKR response: ${xml.slice(0, 300)}`);
  }
  throw new Error(`Timed out waiting for IBKR statement after ${(maxRetries * waitMs) / 1000}s`);
}

function parseBaseCurrency(xml) {
  const m = xml.match(/<AccountInformation[^>]+currency="([^"]+)"/);
  return m ? m[1] : null;
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
  const days = Math.round((new Date(isoTo).getTime() - new Date(isoFrom).getTime()) / 86400000);
  return { fromDate: isoFrom, toDate: isoTo, days };
}

function ibkrDateToIso(dt) {
  if (!dt) return null;
  const [date, time] = dt.split(';');
  if (!date || date.length < 8) return null;
  const d = `${date.slice(0,4)}-${date.slice(4,6)}-${date.slice(6,8)}`;
  const t = (time && time.length >= 6) ? `${time.slice(0,2)}:${time.slice(2,4)}:${time.slice(4,6)}` : '00:00:00';
  return `${d}T${t}`;
}

function parseTrades(xml) {
  const trades = [];
  const re = /<Trade\s([^>]+)\/>/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const attrs = m[1];
    const g = (f) => {
      const x = attrs.match(new RegExp(`${f}="([^"]*)"`));
      return x ? x[1] : null;
    };
    trades.push({
      ibExecID: g('ibExecID'), ibOrderID: g('ibOrderID'), accountId: g('accountId'),
      conid: g('conid'), symbol: g('symbol'), assetCategory: g('assetCategory'),
      buySell: g('buySell'), openCloseIndicator: g('openCloseIndicator'),
      quantity: g('quantity'), tradePrice: g('tradePrice'),
      dateTime: ibkrDateToIso(g('dateTime')),
      netCash: g('netCash'), fifoPnlRealized: g('fifoPnlRealized'),
      ibCommission: g('ibCommission'), ibCommissionCurrency: g('ibCommissionCurrency'),
      currency: g('currency'), fxRateToBase: g('fxRateToBase'),
      transactionType: g('transactionType'), notes: g('notes'),
      multiplier: g('multiplier'), strike: g('strike'), expiry: g('expiry'), putCall: g('putCall'),
    });
  }
  return trades;
}

function parseOpenPositions(xml) {
  const positions = [];
  const re = /<OpenPosition\s([^>]+)\/>/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const attrs = m[1];
    const g = (f) => {
      const x = attrs.match(new RegExp(`${f}="([^"]*)"`));
      return x ? x[1] : null;
    };
    positions.push({
      accountId: g('accountId'), conid: g('conid'), symbol: g('symbol'),
      assetCategory: g('assetCategory'), position: g('position'),
      avgCost: g('avgCost') || g('openPrice'),
      marketValue: g('marketValue') || g('positionValue'),
      unrealizedPnl: g('unrealizedPnl') || g('fifoPnlUnrealized'),
      currency: g('currency'), fxRateToBase: g('fxRateToBase'),
    });
  }
  return positions;
}

// End-to-end sync for one user, using the service-role client. Mirrors what
// api/sync.js + IBKRScreen.handleSync do together when a user clicks
// "Sync now" — but runs entirely server-side so the nightly cron can fire
// it without any browser involvement.
//
// Throws on any failure. On success: updates user_ibkr_credentials.last_sync_at
// and clears any previously-recorded failure state. Caller is responsible for
// writing last_sync_error + last_sync_failed_at on thrown errors.
async function performUserSync(userId, supabaseAdmin) {
  const { data: creds, error: credsError } = await supabaseAdmin
    .from('user_ibkr_credentials')
    .select('ibkr_token, query_id_30d')
    .eq('user_id', userId)
    .single();

  if (credsError || !creds?.ibkr_token || !creds?.query_id_30d) {
    throw new Error('No IBKR credentials on file');
  }

  const refCode = await sendRequest(creds.ibkr_token, creds.query_id_30d);
  const xml = await getStatement(refCode, creds.ibkr_token);

  const MAX_PERIOD_DAYS = 35;
  const period = parseFlexPeriod(xml);
  if (!period) throw new Error('Could not read Flex Query window from IBKR response');
  if (period.days > MAX_PERIOD_DAYS) {
    throw new Error(`Flex Query covers ${period.days} days (${period.fromDate} → ${period.toDate}); max allowed is ${MAX_PERIOD_DAYS}`);
  }

  const trades = parseTrades(xml);
  const openPositions = parseOpenPositions(xml);
  const baseCurrency = parseBaseCurrency(xml);

  // Upsert trades (admin bypasses RLS so no JWT needed)
  if (trades.length > 0) {
    const rows = trades
      .filter(t => t.ibExecID)
      .map(t => ({
        user_id:                userId,
        ib_exec_id:             t.ibExecID,
        ib_order_id:            t.ibOrderID,
        account_id:             t.accountId,
        conid:                  t.conid,
        symbol:                 t.symbol,
        asset_category:         t.assetCategory,
        buy_sell:               t.buySell,
        open_close_indicator:   t.openCloseIndicator,
        quantity:               t.quantity ? parseFloat(t.quantity) : null,
        trade_price:            t.tradePrice ? parseFloat(t.tradePrice) : null,
        date_time:              t.dateTime,
        net_cash:               t.netCash ? parseFloat(t.netCash) : null,
        fifo_pnl_realized:      t.fifoPnlRealized ? parseFloat(t.fifoPnlRealized) : null,
        ib_commission:          t.ibCommission ? parseFloat(t.ibCommission) : null,
        ib_commission_currency: t.ibCommissionCurrency,
        currency:               t.currency,
        fx_rate_to_base:        t.fxRateToBase ? parseFloat(t.fxRateToBase) : 1.0,
        transaction_type:       t.transactionType,
        notes:                  t.notes,
        multiplier:             t.multiplier ? parseFloat(t.multiplier) : null,
        strike:                 t.strike ? parseFloat(t.strike) : null,
        expiry:                 t.expiry,
        put_call:               t.putCall,
      }));
    const { error } = await supabaseAdmin
      .from('trades')
      .upsert(rows, { onConflict: 'user_id,ib_exec_id' });
    if (error) throw new Error(`Trades upsert failed: ${error.message}`);
  }

  // Replace open positions (delete-then-insert pattern matches sync.js)
  await supabaseAdmin.from('open_positions').delete().eq('user_id', userId);
  if (openPositions.length > 0) {
    const rows = openPositions.map(p => ({
      user_id:         userId,
      account_id:      p.accountId,
      conid:           p.conid,
      symbol:          p.symbol,
      asset_category:  p.assetCategory,
      position:        p.position ? parseFloat(p.position) : null,
      avg_cost:        p.avgCost ? parseFloat(p.avgCost) : null,
      market_value:    p.marketValue ? parseFloat(p.marketValue) : null,
      unrealized_pnl:  p.unrealizedPnl ? parseFloat(p.unrealizedPnl) : null,
      currency:        p.currency,
      fx_rate_to_base: p.fxRateToBase ? parseFloat(p.fxRateToBase) : 1.0,
      updated_at:      new Date().toISOString(),
    }));
    const { error } = await supabaseAdmin.from('open_positions').insert(rows);
    if (error) throw new Error(`Positions insert failed: ${error.message}`);
  }

  // Clear any demo rows still sitting around from signup
  await Promise.all([
    supabaseAdmin.from('logical_trades').delete().eq('user_id', userId).eq('is_demo', true),
    supabaseAdmin.from('open_positions').delete().eq('user_id', userId).eq('is_demo', true),
    supabaseAdmin.from('planned_trades').delete().eq('user_id', userId).eq('is_demo', true),
    supabaseAdmin.from('playbooks').delete().eq('user_id', userId).eq('is_demo', true),
  ]);
  await supabaseAdmin
    .from('user_subscriptions')
    .update({ ibkr_connected: true })
    .eq('user_id', userId);

  // Update credentials: last_sync_at + account_id + base_currency; clear failure state
  const accountId = trades[0]?.accountId || openPositions[0]?.accountId;
  const credPayload = {
    last_sync_at: new Date().toISOString(),
    last_sync_error: null,
    last_sync_failed_at: null,
    ...(accountId && { account_id: accountId }),
    ...(baseCurrency && { base_currency: baseCurrency }),
  };
  const { error: credUpdateError } = await supabaseAdmin
    .from('user_ibkr_credentials')
    .update(credPayload)
    .eq('user_id', userId);
  if (credUpdateError) throw new Error(`Credentials update failed: ${credUpdateError.message}`);

  // Rebuild logical trades so the user's screens reflect the new data next
  // time they load. Failure here is still a sync failure.
  const { count, warnings } = await rebuildForUser(userId, supabaseAdmin);

  return {
    tradeCount: trades.length,
    positionCount: openPositions.length,
    logicalCount: count,
    rebuildWarnings: warnings,
  };
}

module.exports = { performUserSync };

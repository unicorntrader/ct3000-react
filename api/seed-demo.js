// ══════════════════════════════════════════════════════════════════════════
// CANONICAL DEMO SEED — keep in sync with ct3000-admin's seedDemoAction in
// api/users/[id]/index.js. Both code paths must produce identical demo
// data so a user reseeded by admin sees the exact same shape they got at
// signup. When you change one, copy the change to the other.
//
// Differences vs the admin version:
//   - This route is JWT-auth'd (user calling on their own behalf), not
//     admin-gated.
//   - Skip-if-already-seeded short-circuits on first call after signup.
//   - No admin_actions audit log row (this isn't an admin-initiated event).
// Everything below the auth + skip block is identical to seedDemoAction.
// ══════════════════════════════════════════════════════════════════════════
const supabaseAdmin = require('./_lib/supabaseAdmin')

const daysAgo = (n) => {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString()
}

// ISO timestamp at "N days ago" + intraday HH:MM. Local-tz semantics are
// fine for demo data; IBKR sync would store true UTC.
const at = (daysIdx, hour = 10, minute = 0) => {
  const d = new Date()
  d.setDate(d.getDate() - daysIdx)
  d.setHours(hour, minute, 0, 0)
  return d.toISOString()
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const authHeader = req.headers.authorization || ''
  if (!authHeader.startsWith('Bearer ')) return res.status(401).json({ error: 'Missing Authorization header' })

  const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(authHeader.slice(7))
  if (authError || !user) return res.status(401).json({ error: 'Unauthorized' })

  const userId = user.id

  // Skip if already seeded — checked via planned_trades because it survives
  // the IBKR-sync wipe better than logical_trades (logicals get rebuilt;
  // demo plans persist until first real sync clears them).
  const { data: existing } = await supabaseAdmin
    .from('planned_trades')
    .select('id')
    .eq('user_id', userId)
    .eq('is_demo', true)
    .limit(1)
  if (existing && existing.length > 0) {
    // Demo rows already exist for this user. Make sure the subscription flag
    // reflects that so App.jsx's DemoBanner gate works correctly — otherwise
    // the banner stays hidden and the user has demo data but no visible CTA
    // to connect IBKR.
    await supabaseAdmin
      .from('user_subscriptions')
      .update({ demo_seeded: true })
      .eq('user_id', userId)
    return res.status(200).json({ already_seeded: true })
  }

  // Clear any stale demo data first so this is safely re-runnable.
  const cleanupResults = await Promise.all([
    supabaseAdmin.from('missed_trades').delete().eq('user_id', userId),
    supabaseAdmin.from('logical_trades').delete().eq('user_id', userId).eq('is_demo', true),
    supabaseAdmin.from('open_positions').delete().eq('user_id', userId).eq('is_demo', true),
    supabaseAdmin.from('planned_trades').delete().eq('user_id', userId).eq('is_demo', true),
    supabaseAdmin.from('playbooks').delete().eq('user_id', userId).eq('is_demo', true),
    supabaseAdmin.from('trades').delete().eq('user_id', userId).eq('is_demo', true),
  ])
  const cleanupErrors = cleanupResults.map(r => r.error?.message).filter(Boolean)
  if (cleanupErrors.length) {
    return res.status(500).json({ error: `cleanup: ${cleanupErrors.join('; ')}` })
  }

  // ── Playbooks first ──
  const { data: playbooks, error: pbErr } = await supabaseAdmin
    .from('playbooks')
    .insert([
      { user_id: userId, name: 'Momentum Breakout', description: 'Price breaks previous swing high on above-avg volume. Entry on confirmation, target prior resistance, stop below breakout level.', is_demo: true },
      { user_id: userId, name: 'Earnings Fade',     description: 'Fade gap-up after earnings when price stalls at prior resistance. 1R target, tight stop above the gap high.', is_demo: true },
      { user_id: userId, name: 'MA30 Retracement',  description: 'Pullback to rising 30MA in established uptrend. Long on bounce, target prior high, stop below MA.', is_demo: true },
    ])
    .select('id, name')

  if (pbErr) return res.status(500).json({ error: `playbooks: ${pbErr.message}` })
  const pbId = Object.fromEntries((playbooks || []).map(p => [p.name, p.id]))

  // ── Planned trades ──
  const { data: plans, error: plansErr } = await supabaseAdmin
    .from('planned_trades')
    .insert([
      { user_id: userId, symbol: 'NVDA', direction: 'LONG',  asset_category: 'STK', strategy: 'Momentum', planned_entry_price: 138, planned_target_price: 165, planned_stop_loss: 130, planned_quantity: 100, thesis: 'Breakout, 2R target',  playbook_id: pbId['Momentum Breakout'], is_demo: true },
      { user_id: userId, symbol: 'AAPL', direction: 'LONG',  asset_category: 'STK', strategy: 'Swing',    planned_entry_price: 183, planned_target_price: 205, planned_stop_loss: 176, planned_quantity: 50,  thesis: 'Earnings dip buy',    playbook_id: pbId['MA30 Retracement'],  is_demo: true },
      { user_id: userId, symbol: 'TSLA', direction: 'SHORT', asset_category: 'STK', strategy: 'Fade',     planned_entry_price: 252, planned_target_price: 225, planned_stop_loss: 262, planned_quantity: 30,  thesis: 'Fade gap up, 1R',     playbook_id: pbId['Earnings Fade'],     is_demo: true },
      { user_id: userId, symbol: 'SPY',  direction: 'LONG',  asset_category: 'STK', strategy: 'Trend',    planned_entry_price: 495, planned_target_price: 512, planned_stop_loss: 488, planned_quantity: 20,  thesis: 'Trend continuation',                                                   is_demo: true },
      { user_id: userId, symbol: 'MSFT', direction: 'LONG',  asset_category: 'STK', strategy: 'Swing',    planned_entry_price: 413, planned_target_price: 440, planned_stop_loss: 405, planned_quantity: 40,  thesis: 'Support bounce',      playbook_id: pbId['MA30 Retracement'],  is_demo: true },
    ])
    .select('id, symbol, direction')

  if (plansErr) return res.status(500).json({ error: `plans: ${plansErr.message}` })
  const planId = Object.fromEntries((plans || []).map(p => [`${p.symbol}_${p.direction}`, p.id]))

  // ── Trade tape ── synthetic IBKR-shaped executions that, run through FIFO,
  // would produce the logical trades inserted below. Most logicals get the
  // trivial 1 BUY + 1 SELL pair (or a single open execution for still-open
  // positions); two get partial-fill treatment to surface scale-in /
  // scale-out behaviour on Daily View.
  const CONIDS = { NVDA: 1001, AAPL: 1002, TSLA: 1003, SPY: 1004, MSFT: 1005, META: 1006, GOOG: 1007, AMD: 1008, UBER: 1009 }

  const TRADES = [
    // Scale-in showcase: 100 NVDA accumulated across 3 BUYs, sold in one SELL.
    // Weighted avg of legs: (25*137 + 50*140 + 25*143) / 100 = 140.00
    { symbol: 'NVDA', direction: 'LONG',  qty: 100, entry: 140.00, pnl:  1000, openIdx: 6,  closeIdx: 5,  match: 'matched',  planTag: 'NVDA_LONG',
      legs: [
        { side: 'BUY',  qty: 25, price: 137.00, oc: 'O', daysAgoIdx: 6, hour: 9,  minute: 32 },
        { side: 'BUY',  qty: 50, price: 140.00, oc: 'O', daysAgoIdx: 6, hour: 11, minute: 15 },
        { side: 'BUY',  qty: 25, price: 143.00, oc: 'O', daysAgoIdx: 6, hour: 14, minute: 30 },
        { side: 'SELL', qty: 100, price: 150.00, oc: 'C', daysAgoIdx: 5, hour: 15, minute: 45 },
      ],
    },
    { symbol: 'NVDA', direction: 'LONG',  qty: 50,  entry: 145.00, pnl:   500, openIdx: 9,  closeIdx: 8 },
    { symbol: 'NVDA', direction: 'SHORT', qty: 100, entry: 160.00, pnl:  1200, openIdx: 14, closeIdx: 12 },
    { symbol: 'NVDA', direction: 'LONG',  qty: 75,  entry: 150.00, pnl:  -600, openIdx: 20, closeIdx: 18, match: 'off_plan' },
    { symbol: 'NVDA', direction: 'SHORT', qty: 80,  entry: 155.00, pnl:  -560, openIdx: 27, closeIdx: 25, match: 'off_plan' },
    { symbol: 'AAPL', direction: 'LONG',  qty: 50,  entry: 185.00, pnl:   550, openIdx: 4,  closeIdx: 3,  match: 'matched',  planTag: 'AAPL_LONG' },
    // Scale-out showcase: 100 AAPL bought once, sold in 2 partial closes.
    // Total realized: 60*(195-188) + 40*(202.50-188) = 420 + 580 = 1000
    { symbol: 'AAPL', direction: 'LONG',  qty: 100, entry: 188.00, pnl:  1000, openIdx: 11, closeIdx: 10,
      legs: [
        { side: 'BUY',  qty: 100, price: 188.00, oc: 'O', daysAgoIdx: 11, hour: 10, minute: 5 },
        { side: 'SELL', qty: 60,  price: 195.00, oc: 'C', daysAgoIdx: 10, hour: 11, minute: 20 },
        { side: 'SELL', qty: 40,  price: 202.50, oc: 'C', daysAgoIdx: 10, hour: 14, minute: 50 },
      ],
    },
    { symbol: 'AAPL', direction: 'LONG',  qty: 75,  entry: 190.00, pnl:   750, openIdx: 17, closeIdx: 15 },
    { symbol: 'AAPL', direction: 'LONG',  qty: 60,  entry: 192.00, pnl:  -420, openIdx: 24, closeIdx: 22, match: 'off_plan' },
    { symbol: 'TSLA', direction: 'LONG',  qty: 30,  entry: 220.00, pnl:   540, openIdx: 5,  closeIdx: 4 },
    { symbol: 'TSLA', direction: 'SHORT', qty: 20,  entry: 250.00, pnl:   300, openIdx: 10, closeIdx: 9,  match: 'matched',  planTag: 'TSLA_SHORT' },
    { symbol: 'TSLA', direction: 'LONG',  qty: 25,  entry: 235.00, pnl:  -375, openIdx: 18, closeIdx: 16, match: 'off_plan' },
    { symbol: 'SPY',  direction: 'LONG',  qty: 20,  entry: 500.00, pnl:   200, openIdx: 3,  closeIdx: 2 },
    { symbol: 'SPY',  direction: 'LONG',  qty: 20,  entry: 505.00, pnl:  -140, openIdx: 22, closeIdx: 20, match: 'off_plan' },
    { symbol: 'MSFT', direction: 'LONG',  qty: 40,  entry: 420.00, pnl:   400, openIdx: 7,  closeIdx: 6 },
    { symbol: 'MSFT', direction: 'LONG',  qty: 35,  entry: 422.00, pnl:  -420, openIdx: 21, closeIdx: 19, match: 'off_plan' },
    // Currently-open positions — single open leg, no close.
    { symbol: 'NVDA', direction: 'LONG',  qty: 50,  entry: 162.00, openIdx: 1,  status: 'open', match: 'off_plan' },
    { symbol: 'AAPL', direction: 'LONG',  qty: 100, entry: 193.00, openIdx: 2,  status: 'open', match: 'off_plan' },
    { symbol: 'TSLA', direction: 'LONG',  qty: 20,  entry: 238.00, openIdx: 1,  status: 'open', match: 'off_plan' },
  ]

  function defaultLegs(t) {
    const isOpen = t.status === 'open'
    const openSide = t.direction === 'LONG' ? 'BUY' : 'SELL'
    const closeSide = t.direction === 'LONG' ? 'SELL' : 'BUY'
    const legs = [
      { side: openSide, qty: t.qty, price: t.entry, oc: 'O', daysAgoIdx: t.openIdx, hour: 10, minute: 0 },
    ]
    if (!isOpen) {
      const exit = t.direction === 'LONG'
        ? t.entry + t.pnl / t.qty
        : t.entry - t.pnl / t.qty
      legs.push({ side: closeSide, qty: t.qty, price: exit, oc: 'C', daysAgoIdx: t.closeIdx, hour: 14, minute: 30 })
    }
    return legs
  }

  const rawTrades = []
  const logicalTrades = []
  let execSeq = 0
  let orderSeq = 0

  for (const t of TRADES) {
    const legs = t.legs || defaultLegs(t)
    const conid = CONIDS[t.symbol]
    const closeQty = legs.filter(l => l.oc === 'C').reduce((s, l) => s + l.qty, 0)

    let openingOrderId = null
    for (const leg of legs) {
      const orderId = `demo-order-${++orderSeq}`
      if (leg.oc === 'O' && !openingOrderId) openingOrderId = orderId
      rawTrades.push({
        user_id: userId,
        ib_exec_id: `demo-exec-${++execSeq}`,
        ib_order_id: orderId,
        account_id: 'DEMO-U0000000',
        conid,
        symbol: t.symbol,
        asset_category: 'STK',
        buy_sell: leg.side,
        open_close_indicator: leg.oc,
        quantity: leg.qty,
        trade_price: leg.price,
        date_time: at(leg.daysAgoIdx, leg.hour, leg.minute),
        fifo_pnl_realized: leg.oc === 'C'
          ? (t.direction === 'LONG'
              ? leg.qty * (leg.price - t.entry)
              : leg.qty * (t.entry - leg.price))
          : 0,
        ib_commission: 0,
        ib_commission_currency: 'USD',
        currency: 'USD',
        multiplier: 1,
        fx_rate_to_base: 1,
        is_demo: true,
      })
    }

    const isOpen = t.status === 'open'
    logicalTrades.push({
      user_id: userId,
      asset_category: 'STK',
      symbol: t.symbol,
      conid,
      direction: t.direction,
      opening_ib_order_id: openingOrderId,
      opened_at: at(t.openIdx, 10, 0),
      closed_at: isOpen ? null : at(t.closeIdx, 14, 30),
      status: isOpen ? 'open' : 'closed',
      total_opening_quantity: t.qty,
      total_closing_quantity: isOpen ? 0 : closeQty,
      remaining_quantity: isOpen ? t.qty : 0,
      avg_entry_price: t.entry,
      total_realized_pnl: isOpen ? null : t.pnl,
      fx_rate_to_base: 1,
      currency: 'USD',
      matching_status: t.match || 'needs_review',
      planned_trade_id: t.planTag ? planId[t.planTag] : null,
      is_demo: true,
    })
  }

  const { error: trErr } = await supabaseAdmin.from('trades').insert(rawTrades)
  if (trErr) return res.status(500).json({ error: `trades: ${trErr.message}` })

  const { error: ltErr } = await supabaseAdmin.from('logical_trades').insert(logicalTrades)
  if (ltErr) return res.status(500).json({ error: `logical_trades: ${ltErr.message}` })

  const { error: opErr } = await supabaseAdmin.from('open_positions').insert([
    { user_id: userId, symbol: 'NVDA', asset_category: 'STK', position: 50,  avg_cost: 162.00, market_value: 8250,  unrealized_pnl: 150, currency: 'USD', fx_rate_to_base: 1, updated_at: new Date().toISOString(), is_demo: true },
    { user_id: userId, symbol: 'AAPL', asset_category: 'STK', position: 100, avg_cost: 193.00, market_value: 19500, unrealized_pnl: 200, currency: 'USD', fx_rate_to_base: 1, updated_at: new Date().toISOString(), is_demo: true },
    { user_id: userId, symbol: 'TSLA', asset_category: 'STK', position: 20,  avg_cost: 238.00, market_value: 4840,  unrealized_pnl: 80,  currency: 'USD', fx_rate_to_base: 1, updated_at: new Date().toISOString(), is_demo: true },
  ])
  if (opErr) return res.status(500).json({ error: `open_positions: ${opErr.message}` })

  const { error: mtErr } = await supabaseAdmin.from('missed_trades').insert([
    { user_id: userId, symbol: 'META', direction: 'LONG',  strategy: 'Momentum', noted_entry_price: 495, noted_at: daysAgo(4), notes: 'Saw the breakout at 495, froze on entry. Ran to 520.',                  playbook_id: pbId['Momentum Breakout'] },
    { user_id: userId, symbol: 'GOOG', direction: 'LONG',  strategy: 'Swing',    noted_entry_price: 168, noted_at: daysAgo(9), notes: 'MA30 pullback, clean setup. Was on a call. Missed the entry.',          playbook_id: pbId['MA30 Retracement']  },
    { user_id: userId, symbol: 'AMD',  direction: 'SHORT', strategy: 'Fade',     noted_entry_price: 178, noted_at: daysAgo(2), notes: 'Gap-up fade, rejected at prior resistance. Hesitated, missed it.',       playbook_id: pbId['Earnings Fade']     },
    { user_id: userId, symbol: 'UBER', direction: 'LONG',  strategy: null,       noted_entry_price: 78,  noted_at: daysAgo(6), notes: 'Just had a gut feeling. No specific setup.',                             playbook_id: null                      },
  ])
  if (mtErr) return res.status(500).json({ error: `missed_trades: ${mtErr.message}` })

  await supabaseAdmin
    .from('user_subscriptions')
    .update({ demo_seeded: true, has_seen_welcome: true })
    .eq('user_id', userId)

  console.log('[seed-demo] seeded demo data for userId:', userId)
  return res.status(200).json({ success: true })
}

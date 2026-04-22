const supabaseAdmin = require('./_lib/supabaseAdmin')

function daysAgo(n) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString()
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const authHeader = req.headers.authorization || ''
  if (!authHeader.startsWith('Bearer ')) return res.status(401).json({ error: 'Missing Authorization header' })

  const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(authHeader.slice(7))
  if (authError || !user) return res.status(401).json({ error: 'Unauthorized' })

  // Demo seeding runs for newly signed-up users on first login so they have
  // something to explore before connecting IBKR. The "already seeded" check
  // below prevents repeated calls from duplicating data.
  const userId = user.id

  // Skip if already seeded — check planned_trades (survives IBKR sync better than logical_trades)
  const { data: existing } = await supabaseAdmin
    .from('planned_trades')
    .select('id')
    .eq('user_id', userId)
    .eq('is_demo', true)
    .limit(1)
  if (existing && existing.length > 0) {
    // Demo rows already exist for this user. Make sure the subscription flag
    // reflects that so App.jsx's DemoBanner gate works correctly -- otherwise
    // the banner stays hidden and the user has demo data but no visible CTA
    // to connect IBKR.
    await supabaseAdmin
      .from('user_subscriptions')
      .update({ demo_seeded: true })
      .eq('user_id', userId)
    return res.status(200).json({ already_seeded: true })
  }

  // Clear any stale demo data first
  await Promise.all([
    supabaseAdmin.from('logical_trades').delete().eq('user_id', userId).eq('is_demo', true),
    supabaseAdmin.from('open_positions').delete().eq('user_id', userId).eq('is_demo', true),
    supabaseAdmin.from('planned_trades').delete().eq('user_id', userId).eq('is_demo', true),
    supabaseAdmin.from('playbooks').delete().eq('user_id', userId).eq('is_demo', true),
  ])

  // ── Step 1: Insert planned trades first — need IDs to link matched logical trades ──

  // 3 executed plans (will be matched to logical trades)
  // 2 pending plans (still waiting for entry)
  const plannedTradesData = [
    { user_id: userId, symbol: 'NVDA', direction: 'LONG',  asset_category: 'STK', strategy: 'Demo', planned_entry_price: 138, planned_target_price: 165, planned_stop_loss: 130, planned_quantity: 100, thesis: 'Breakout, 2R target',  is_demo: true },
    { user_id: userId, symbol: 'AAPL', direction: 'LONG',  asset_category: 'STK', strategy: 'Demo', planned_entry_price: 183, planned_target_price: 205, planned_stop_loss: 176, planned_quantity: 50,  thesis: 'Earnings dip buy',    is_demo: true },
    { user_id: userId, symbol: 'TSLA', direction: 'SHORT', asset_category: 'STK', strategy: 'Demo', planned_entry_price: 252, planned_target_price: 225, planned_stop_loss: 262, planned_quantity: 30,  thesis: 'Fade gap up, 1R',     is_demo: true },
    { user_id: userId, symbol: 'SPY',  direction: 'LONG',  asset_category: 'STK', strategy: 'Demo', planned_entry_price: 495, planned_target_price: 512, planned_stop_loss: 488, planned_quantity: 20,  thesis: 'Trend continuation', is_demo: true },
    { user_id: userId, symbol: 'MSFT', direction: 'LONG',  asset_category: 'STK', strategy: 'Demo', planned_entry_price: 413, planned_target_price: 440, planned_stop_loss: 405, planned_quantity: 40,  thesis: 'Support bounce',     is_demo: true },
  ]

  const { data: plans, error: plansErr } = await supabaseAdmin
    .from('planned_trades')
    .insert(plannedTradesData)
    .select('id, symbol, direction')

  if (plansErr || !plans) {
    console.error('[seed-demo] planned_trades insert error:', plansErr?.message)
    return res.status(500).json({ error: plansErr?.message || 'Failed to insert plans' })
  }

  // Build lookup: 'NVDA_LONG' → uuid
  const planId = {}
  for (const p of plans) planId[`${p.symbol}_${p.direction}`] = p.id

  // ── Step 2: Build logical trades ──

  // Closed trade helper
  const lt = (overrides) => ({
    user_id: userId,
    asset_category: 'STK',
    status: 'closed',
    total_closing_quantity: overrides.total_opening_quantity,
    remaining_quantity: 0,
    fx_rate_to_base: 1,
    currency: 'USD',
    matching_status: 'needs_review',
    is_reversal: false,
    planned_trade_id: null,
    is_demo: true,
    ...overrides,
  })

  // Open trade helper (still in position — appears in Journal "Open" tab)
  const ltOpen = (overrides) => ({
    user_id: userId,
    asset_category: 'STK',
    status: 'open',
    total_closing_quantity: 0,
    remaining_quantity: overrides.total_opening_quantity,
    total_realized_pnl: null,
    closed_at: null,
    fx_rate_to_base: 1,
    currency: 'USD',
    matching_status: 'off_plan',
    is_reversal: false,
    planned_trade_id: null,
    is_demo: true,
    ...overrides,
  })

  const logicalTrades = [
    // ── NVDA ─────────────────────────────────────────────────────────────────
    // Matched: linked to NVDA LONG plan — shows R multiple in Journal
    lt({ symbol: 'NVDA', direction: 'LONG',  opened_at: daysAgo(6),  closed_at: daysAgo(5),  total_opening_quantity: 100, avg_entry_price: 140.00, total_realized_pnl: 1000,  planned_trade_id: planId['NVDA_LONG'], matching_status: 'matched'   }),
    lt({ symbol: 'NVDA', direction: 'LONG',  opened_at: daysAgo(9),  closed_at: daysAgo(8),  total_opening_quantity: 50,  avg_entry_price: 145.00, total_realized_pnl: 500                                                                              }),
    lt({ symbol: 'NVDA', direction: 'SHORT', opened_at: daysAgo(14), closed_at: daysAgo(12), total_opening_quantity: 100, avg_entry_price: 160.00, total_realized_pnl: 1200                                                                             }),
    lt({ symbol: 'NVDA', direction: 'LONG',  opened_at: daysAgo(20), closed_at: daysAgo(18), total_opening_quantity: 75,  avg_entry_price: 150.00, total_realized_pnl: -600,  matching_status: 'off_plan'                                              }),
    lt({ symbol: 'NVDA', direction: 'SHORT', opened_at: daysAgo(27), closed_at: daysAgo(25), total_opening_quantity: 80,  avg_entry_price: 155.00, total_realized_pnl: -560,  matching_status: 'off_plan'                                              }),

    // ── AAPL ─────────────────────────────────────────────────────────────────
    lt({ symbol: 'AAPL', direction: 'LONG',  opened_at: daysAgo(4),  closed_at: daysAgo(3),  total_opening_quantity: 50,  avg_entry_price: 185.00, total_realized_pnl: 550,   planned_trade_id: planId['AAPL_LONG'], matching_status: 'matched'   }),
    lt({ symbol: 'AAPL', direction: 'LONG',  opened_at: daysAgo(11), closed_at: daysAgo(10), total_opening_quantity: 100, avg_entry_price: 188.00, total_realized_pnl: 1000                                                                             }),
    lt({ symbol: 'AAPL', direction: 'LONG',  opened_at: daysAgo(17), closed_at: daysAgo(15), total_opening_quantity: 75,  avg_entry_price: 190.00, total_realized_pnl: 750                                                                              }),
    lt({ symbol: 'AAPL', direction: 'LONG',  opened_at: daysAgo(24), closed_at: daysAgo(22), total_opening_quantity: 60,  avg_entry_price: 192.00, total_realized_pnl: -420,  matching_status: 'off_plan'                                              }),

    // ── TSLA ─────────────────────────────────────────────────────────────────
    lt({ symbol: 'TSLA', direction: 'LONG',  opened_at: daysAgo(5),  closed_at: daysAgo(4),  total_opening_quantity: 30,  avg_entry_price: 220.00, total_realized_pnl: 540                                                                              }),
    lt({ symbol: 'TSLA', direction: 'SHORT', opened_at: daysAgo(10), closed_at: daysAgo(9),  total_opening_quantity: 20,  avg_entry_price: 250.00, total_realized_pnl: 300,   planned_trade_id: planId['TSLA_SHORT'], matching_status: 'matched'  }),
    lt({ symbol: 'TSLA', direction: 'LONG',  opened_at: daysAgo(18), closed_at: daysAgo(16), total_opening_quantity: 25,  avg_entry_price: 235.00, total_realized_pnl: -375,  matching_status: 'off_plan'                                              }),
    lt({ symbol: 'TSLA', direction: 'SHORT', opened_at: daysAgo(26), closed_at: daysAgo(24), total_opening_quantity: 30,  avg_entry_price: 240.00, total_realized_pnl: -450                                                                             }),

    // ── SPY ──────────────────────────────────────────────────────────────────
    lt({ symbol: 'SPY',  direction: 'LONG',  opened_at: daysAgo(3),  closed_at: daysAgo(2),  total_opening_quantity: 20,  avg_entry_price: 500.00, total_realized_pnl: 200                                                                              }),
    lt({ symbol: 'SPY',  direction: 'LONG',  opened_at: daysAgo(8),  closed_at: daysAgo(7),  total_opening_quantity: 15,  avg_entry_price: 495.00, total_realized_pnl: 195                                                                              }),
    lt({ symbol: 'SPY',  direction: 'LONG',  opened_at: daysAgo(15), closed_at: daysAgo(13), total_opening_quantity: 25,  avg_entry_price: 498.00, total_realized_pnl: 300                                                                              }),
    lt({ symbol: 'SPY',  direction: 'LONG',  opened_at: daysAgo(22), closed_at: daysAgo(20), total_opening_quantity: 20,  avg_entry_price: 505.00, total_realized_pnl: -140,  matching_status: 'off_plan'                                              }),

    // ── MSFT ─────────────────────────────────────────────────────────────────
    lt({ symbol: 'MSFT', direction: 'LONG',  opened_at: daysAgo(7),  closed_at: daysAgo(6),  total_opening_quantity: 40,  avg_entry_price: 420.00, total_realized_pnl: 400                                                                              }),
    lt({ symbol: 'MSFT', direction: 'LONG',  opened_at: daysAgo(13), closed_at: daysAgo(11), total_opening_quantity: 30,  avg_entry_price: 415.00, total_realized_pnl: 300                                                                              }),
    lt({ symbol: 'MSFT', direction: 'LONG',  opened_at: daysAgo(21), closed_at: daysAgo(19), total_opening_quantity: 35,  avg_entry_price: 422.00, total_realized_pnl: -420,  matching_status: 'off_plan'                                              }),

    // ── Open trades (Journal "Open" tab) ─────────────────────────────────────
    ltOpen({ symbol: 'NVDA', direction: 'LONG', opened_at: daysAgo(1), total_opening_quantity: 50,  avg_entry_price: 162.00 }),
    ltOpen({ symbol: 'AAPL', direction: 'LONG', opened_at: daysAgo(2), total_opening_quantity: 100, avg_entry_price: 193.00 }),
    ltOpen({ symbol: 'TSLA', direction: 'LONG', opened_at: daysAgo(1), total_opening_quantity: 20,  avg_entry_price: 238.00 }),
  ]

  // ── Step 3: Insert logical trades ──
  const { error: ltErr } = await supabaseAdmin.from('logical_trades').insert(logicalTrades)
  if (ltErr) {
    console.error('[seed-demo] logical_trades insert error:', ltErr.message)
    return res.status(500).json({ error: ltErr.message })
  }

  // ── Step 4: Insert open positions and playbooks in parallel ──
  const openPositions = [
    { user_id: userId, symbol: 'NVDA', asset_category: 'STK', position: 50,  avg_cost: 162.00, market_value: 8250,  unrealized_pnl: 150, currency: 'USD', updated_at: new Date().toISOString(), is_demo: true },
    { user_id: userId, symbol: 'AAPL', asset_category: 'STK', position: 100, avg_cost: 193.00, market_value: 19500, unrealized_pnl: 200, currency: 'USD', updated_at: new Date().toISOString(), is_demo: true },
    { user_id: userId, symbol: 'TSLA', asset_category: 'STK', position: 20,  avg_cost: 238.00, market_value: 4840,  unrealized_pnl: 80,  currency: 'USD', updated_at: new Date().toISOString(), is_demo: true },
    { user_id: userId, symbol: 'SPY',  asset_category: 'STK', position: 10,  avg_cost: 510.00, market_value: 5120,  unrealized_pnl: 20,  currency: 'USD', updated_at: new Date().toISOString(), is_demo: true },
    { user_id: userId, symbol: 'MSFT', asset_category: 'STK', position: 30,  avg_cost: 428.00, market_value: 12900, unrealized_pnl: 60,  currency: 'USD', updated_at: new Date().toISOString(), is_demo: true },
  ]

  const playbooks = [
    { user_id: userId, name: 'Momentum Breakout', notes: 'Breakout, 2R target', is_demo: true },
    { user_id: userId, name: 'Earnings Fade',     notes: 'Fade gap up, 1R',    is_demo: true },
  ]

  const [posRes, pbRes] = await Promise.all([
    supabaseAdmin.from('open_positions').insert(openPositions),
    supabaseAdmin.from('playbooks').insert(playbooks),
  ])

  const errors = [posRes.error, pbRes.error].filter(Boolean)
  if (errors.length) {
    console.error('[seed-demo] insert errors:', errors.map(e => e.message))
    return res.status(500).json({ error: errors[0].message })
  }

  // ── Step 5: Mark subscription flag so App.jsx DemoBanner shows ──
  await supabaseAdmin
    .from('user_subscriptions')
    .update({ demo_seeded: true })
    .eq('user_id', userId)

  console.log('[seed-demo] seeded demo data for userId:', userId)
  return res.status(200).json({ success: true })
}

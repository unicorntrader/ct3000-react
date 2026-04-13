const supabaseAdmin = require('./lib/supabaseAdmin')

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

  const userId = user.id

  // Clear any stale demo data first
  await Promise.all([
    supabaseAdmin.from('logical_trades').delete().eq('user_id', userId).eq('is_demo', true),
    supabaseAdmin.from('open_positions').delete().eq('user_id', userId).eq('is_demo', true),
    supabaseAdmin.from('planned_trades').delete().eq('user_id', userId).eq('is_demo', true),
    supabaseAdmin.from('playbooks').delete().eq('user_id', userId).eq('is_demo', true),
  ])

  const lt = (overrides) => ({
    user_id: userId,
    asset_category: 'STK',
    status: 'closed',
    total_closing_quantity: overrides.total_opening_quantity,
    remaining_quantity: 0,
    fx_rate_to_base: 1,
    currency: 'USD',
    matching_status: 'auto',
    is_reversal: false,
    planned_trade_id: null,
    is_demo: true,
    ...overrides,
  })

  const logicalTrades = [
    // NVDA — 3W/2L
    lt({ symbol: 'NVDA', direction: 'LONG',  opened_at: daysAgo(6),  closed_at: daysAgo(5),  total_opening_quantity: 100, avg_entry_price: 140.00, total_realized_pnl: 1000  }),
    lt({ symbol: 'NVDA', direction: 'LONG',  opened_at: daysAgo(9),  closed_at: daysAgo(8),  total_opening_quantity: 50,  avg_entry_price: 145.00, total_realized_pnl: 500   }),
    lt({ symbol: 'NVDA', direction: 'SHORT', opened_at: daysAgo(14), closed_at: daysAgo(12), total_opening_quantity: 100, avg_entry_price: 160.00, total_realized_pnl: 1200  }),
    lt({ symbol: 'NVDA', direction: 'LONG',  opened_at: daysAgo(20), closed_at: daysAgo(18), total_opening_quantity: 75,  avg_entry_price: 150.00, total_realized_pnl: -600  }),
    lt({ symbol: 'NVDA', direction: 'SHORT', opened_at: daysAgo(27), closed_at: daysAgo(25), total_opening_quantity: 80,  avg_entry_price: 155.00, total_realized_pnl: -560  }),
    // AAPL — 3W/1L
    lt({ symbol: 'AAPL', direction: 'LONG',  opened_at: daysAgo(4),  closed_at: daysAgo(3),  total_opening_quantity: 50,  avg_entry_price: 185.00, total_realized_pnl: 550   }),
    lt({ symbol: 'AAPL', direction: 'LONG',  opened_at: daysAgo(11), closed_at: daysAgo(10), total_opening_quantity: 100, avg_entry_price: 188.00, total_realized_pnl: 1000  }),
    lt({ symbol: 'AAPL', direction: 'LONG',  opened_at: daysAgo(17), closed_at: daysAgo(15), total_opening_quantity: 75,  avg_entry_price: 190.00, total_realized_pnl: 750   }),
    lt({ symbol: 'AAPL', direction: 'LONG',  opened_at: daysAgo(24), closed_at: daysAgo(22), total_opening_quantity: 60,  avg_entry_price: 192.00, total_realized_pnl: -420  }),
    // TSLA — 2W/2L
    lt({ symbol: 'TSLA', direction: 'LONG',  opened_at: daysAgo(5),  closed_at: daysAgo(4),  total_opening_quantity: 30,  avg_entry_price: 220.00, total_realized_pnl: 540   }),
    lt({ symbol: 'TSLA', direction: 'SHORT', opened_at: daysAgo(10), closed_at: daysAgo(9),  total_opening_quantity: 20,  avg_entry_price: 250.00, total_realized_pnl: 300   }),
    lt({ symbol: 'TSLA', direction: 'LONG',  opened_at: daysAgo(18), closed_at: daysAgo(16), total_opening_quantity: 25,  avg_entry_price: 235.00, total_realized_pnl: -375  }),
    lt({ symbol: 'TSLA', direction: 'SHORT', opened_at: daysAgo(26), closed_at: daysAgo(24), total_opening_quantity: 30,  avg_entry_price: 240.00, total_realized_pnl: -450  }),
    // SPY — 3W/1L
    lt({ symbol: 'SPY',  direction: 'LONG',  opened_at: daysAgo(3),  closed_at: daysAgo(2),  total_opening_quantity: 20,  avg_entry_price: 500.00, total_realized_pnl: 200   }),
    lt({ symbol: 'SPY',  direction: 'LONG',  opened_at: daysAgo(8),  closed_at: daysAgo(7),  total_opening_quantity: 15,  avg_entry_price: 495.00, total_realized_pnl: 195   }),
    lt({ symbol: 'SPY',  direction: 'LONG',  opened_at: daysAgo(15), closed_at: daysAgo(13), total_opening_quantity: 25,  avg_entry_price: 498.00, total_realized_pnl: 300   }),
    lt({ symbol: 'SPY',  direction: 'LONG',  opened_at: daysAgo(22), closed_at: daysAgo(20), total_opening_quantity: 20,  avg_entry_price: 505.00, total_realized_pnl: -140  }),
    // MSFT — 2W/1L
    lt({ symbol: 'MSFT', direction: 'LONG',  opened_at: daysAgo(7),  closed_at: daysAgo(6),  total_opening_quantity: 40,  avg_entry_price: 420.00, total_realized_pnl: 400   }),
    lt({ symbol: 'MSFT', direction: 'LONG',  opened_at: daysAgo(13), closed_at: daysAgo(11), total_opening_quantity: 30,  avg_entry_price: 415.00, total_realized_pnl: 300   }),
    lt({ symbol: 'MSFT', direction: 'LONG',  opened_at: daysAgo(21), closed_at: daysAgo(19), total_opening_quantity: 35,  avg_entry_price: 422.00, total_realized_pnl: -420  }),
  ]

  const openPositions = [
    { user_id: userId, symbol: 'NVDA', asset_category: 'STK', position: 50,  avg_cost: 162.00, market_value: 8250,   unrealized_pnl: 150,  currency: 'USD', updated_at: new Date().toISOString(), is_demo: true },
    { user_id: userId, symbol: 'AAPL', asset_category: 'STK', position: 100, avg_cost: 193.00, market_value: 19500,  unrealized_pnl: 200,  currency: 'USD', updated_at: new Date().toISOString(), is_demo: true },
    { user_id: userId, symbol: 'TSLA', asset_category: 'STK', position: 20,  avg_cost: 238.00, market_value: 4840,   unrealized_pnl: 80,   currency: 'USD', updated_at: new Date().toISOString(), is_demo: true },
    { user_id: userId, symbol: 'SPY',  asset_category: 'STK', position: 10,  avg_cost: 510.00, market_value: 5120,   unrealized_pnl: 20,   currency: 'USD', updated_at: new Date().toISOString(), is_demo: true },
    { user_id: userId, symbol: 'MSFT', asset_category: 'STK', position: 30,  avg_cost: 428.00, market_value: 12900,  unrealized_pnl: 60,   currency: 'USD', updated_at: new Date().toISOString(), is_demo: true },
  ]

  const plannedTrades = [
    { user_id: userId, symbol: 'NVDA', direction: 'LONG',  planned_entry_price: 167, planned_target_price: 185, planned_stop_loss: 158, planned_quantity: 50,  is_demo: true },
    { user_id: userId, symbol: 'AAPL', direction: 'LONG',  planned_entry_price: 195, planned_target_price: 210, planned_stop_loss: 188, planned_quantity: 100, is_demo: true },
    { user_id: userId, symbol: 'TSLA', direction: 'SHORT', planned_entry_price: 245, planned_target_price: 220, planned_stop_loss: 255, planned_quantity: 30,  is_demo: true },
  ]

  const playbooks = [
    { user_id: userId, name: 'Momentum Breakout', notes: 'Enter on volume confirmation, stop below breakout candle, target 2R', is_demo: true },
    { user_id: userId, name: 'Earnings Fade',     notes: 'Sell the gap up on earnings, tight stop above high, quick 1R target',  is_demo: true },
  ]

  const [ltRes, posRes, planRes, pbRes] = await Promise.all([
    supabaseAdmin.from('logical_trades').insert(logicalTrades),
    supabaseAdmin.from('open_positions').insert(openPositions),
    supabaseAdmin.from('planned_trades').insert(plannedTrades),
    supabaseAdmin.from('playbooks').insert(playbooks),
  ])

  const errors = [ltRes.error, posRes.error, planRes.error, pbRes.error].filter(Boolean)
  if (errors.length) {
    console.error('[seed-demo] insert errors:', errors.map(e => e.message))
    return res.status(500).json({ error: errors[0].message })
  }

  // Mark has_seen_welcome and demo_seeded in user_subscriptions
  await supabaseAdmin
    .from('user_subscriptions')
    .update({ has_seen_welcome: true, demo_seeded: true })
    .eq('user_id', userId)

  // Track anonymous sessions for admin visibility
  if (user.is_anonymous) {
    await supabaseAdmin.from('anonymous_sessions').upsert(
      { user_id: userId, created_at: new Date().toISOString(), is_anonymous: true },
      { onConflict: 'user_id' }
    )
  }

  console.log('[seed-demo] seeded demo data for userId:', userId, '| anon:', !!user.is_anonymous)
  return res.status(200).json({ success: true })
}

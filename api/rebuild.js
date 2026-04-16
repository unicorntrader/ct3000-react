const { createClient } = require('@supabase/supabase-js');
const { buildLogicalTrades } = require('./lib/logicalTradeBuilder');
const { computeAdherenceScore } = require('./lib/adherenceScore');

const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || 'https://ct3000-react.vercel.app';

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Apply plan matching in-place before insert — avoids N+1 update round-trips.
// When a trade is matched to exactly one plan AND it's closed, also compute
// and set adherence_score so users see it without having to manually open
// each drawer. Open trades get null (no exit price yet).
// Returns an array of { planId, currency } for plans that need their currency
// backfilled from the trade data (plan has no currency, trade does).
function applyPlanMatching(logicalTrades, plannedTrades) {
  const plansById = new Map();
  for (const pt of plannedTrades) plansById.set(pt.id, pt);
  const currencyBackfills = [];

  for (const lt of logicalTrades) {
    if (lt.matching_status === 'manual') {
      if (lt.status === 'closed' && lt.planned_trade_id) {
        const plan = plansById.get(lt.planned_trade_id);
        if (plan) lt.adherence_score = computeAdherenceScore(plan, lt);
      }
      continue;
    }

    const matches = plannedTrades.filter(pt =>
      pt.symbol?.trim().toUpperCase() === lt.symbol?.trim().toUpperCase() &&
      pt.direction?.trim().toUpperCase() === lt.direction?.trim().toUpperCase() &&
      pt.asset_category?.trim().toUpperCase() === lt.asset_category?.trim().toUpperCase()
    );

    if (matches.length === 1) {
      lt.matching_status = 'matched';
      lt.planned_trade_id = matches[0].id;
      if (lt.status === 'closed') {
        lt.adherence_score = computeAdherenceScore(matches[0], lt);
      }
      // Backfill plan currency from trade if plan doesn't have one
      if (!matches[0].currency && lt.currency) {
        currencyBackfills.push({ planId: matches[0].id, currency: lt.currency });
        matches[0].currency = lt.currency; // update in-memory too
      }
    } else if (matches.length === 0) {
      // Zero plan candidates → off_plan. No plan exists for this
      // symbol/direction/asset_category combo, so there is nothing for the
      // user to review. Bypasses the /review queue.
      lt.matching_status = 'off_plan';
      lt.planned_trade_id = null;
      lt.adherence_score = null;
    } else {
      lt.matching_status = 'ambiguous';
      lt.planned_trade_id = null;
      lt.adherence_score = null;
    }
  }
  return currencyBackfills;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing Authorization header' });
  }

  const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(authHeader.slice(7));
  if (authError || !user) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  const userId = user.id;

  const { data: allTrades, error: fetchError } = await supabaseAdmin
    .from('trades')
    .select('*')
    .eq('user_id', userId)
    .order('date_time', { ascending: true });

  if (fetchError) {
    return res.status(500).json({ success: false, error: `Could not fetch trades: ${fetchError.message}` });
  }

  if (!allTrades?.length) {
    return res.status(200).json({ success: true, count: 0, warnings: [] });
  }

  const warnings = [];
  const missingFxRate = allTrades.filter(t => t.fx_rate_to_base == null).length;
  const missingCurrency = allTrades.filter(t => !t.currency).length;
  if (missingFxRate > 0) warnings.push(`${missingFxRate} trade(s) have no FX rate — run Sync Now to fix`);
  if (missingCurrency > 0) warnings.push(`${missingCurrency} trade(s) have no currency — run Sync Now to fix`);

  // Fetch existing logical trades so we can preserve user-written data
  // (review_notes, manual matching) across the delete + re-insert.
  // Key: opening_ib_order_id + ':' + conid — stable across rebuilds.
  const { data: existingLogical } = await supabaseAdmin
    .from('logical_trades')
    .select('opening_ib_order_id, conid, review_notes, matching_status, planned_trade_id')
    .eq('user_id', userId);

  const preservedByKey = new Map();
  for (const row of (existingLogical || [])) {
    if (!row.opening_ib_order_id) continue;
    const key = `${row.opening_ib_order_id}:${row.conid ?? ''}`;
    preservedByKey.set(key, {
      review_notes: row.review_notes || null,
      was_manual: row.matching_status === 'manual',
      manual_planned_trade_id: row.matching_status === 'manual' ? row.planned_trade_id : null,
    });
  }

  // Build in memory
  const logical = buildLogicalTrades(allTrades, userId);
  if (!logical.length) {
    return res.status(200).json({ success: true, count: 0, warnings });
  }

  // Apply preservation: restore review_notes always; restore manual match if
  // the user had one, so the plan-matching pass below skips it.
  let preservedCount = 0;
  for (const lt of logical) {
    if (!lt.opening_ib_order_id) continue;
    const key = `${lt.opening_ib_order_id}:${lt.conid ?? ''}`;
    const p = preservedByKey.get(key);
    if (!p) continue;
    if (p.review_notes) {
      lt.review_notes = p.review_notes;
      preservedCount++;
    }
    if (p.was_manual) {
      lt.matching_status = 'manual';
      lt.planned_trade_id = p.manual_planned_trade_id;
    }
  }
  if (preservedCount > 0) {
    console.log(`[rebuild] userId=${userId} — preserved review_notes on ${preservedCount} trade(s)`);
  }

  // Fetch plans and apply matching before insert — single insert, no update pass needed.
  // Manual matches are preserved by applyPlanMatching (it skips them).
  const { data: plannedTrades } = await supabaseAdmin
    .from('planned_trades')
    .select('*')
    .eq('user_id', userId);

  let currencyBackfills = [];
  if (plannedTrades?.length) {
    currencyBackfills = applyPlanMatching(logical, plannedTrades);
  }

  // Backfill plan currencies from trade data where plans were missing them
  if (currencyBackfills.length > 0) {
    for (const { planId, currency } of currencyBackfills) {
      await supabaseAdmin
        .from('planned_trades')
        .update({ currency })
        .eq('id', planId)
        .eq('user_id', userId);
    }
    console.log(`[rebuild] backfilled currency on ${currencyBackfills.length} plan(s)`);
  }

  // Swap: delete old → insert new
  const { error: deleteError } = await supabaseAdmin
    .from('logical_trades')
    .delete()
    .eq('user_id', userId);

  if (deleteError) {
    return res.status(500).json({ success: false, error: `Could not clear old logical trades: ${deleteError.message}` });
  }

  const { error: insertError } = await supabaseAdmin
    .from('logical_trades')
    .insert(logical);

  if (insertError) {
    return res.status(500).json({ success: false, error: insertError.message });
  }

  console.log(`[rebuild] userId=${userId} — inserted ${logical.length} logical trades`);

  return res.status(200).json({ success: true, count: logical.length, warnings });
};

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
function applyPlanMatching(logicalTrades, plannedTrades) {
  const plansById = new Map();
  for (const pt of plannedTrades) plansById.set(pt.id, pt);

  for (const lt of logicalTrades) {
    if (lt.matching_status === 'manual') {
      // Preserve manual match but still (re)compute adherence if closed + plan exists
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
    } else if (matches.length === 0) {
      lt.matching_status = 'unmatched';
      lt.planned_trade_id = null;
      lt.adherence_score = null;
    } else {
      lt.matching_status = 'ambiguous';
      lt.planned_trade_id = null;
      lt.adherence_score = null;
    }
  }
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

  // Build in memory
  const logical = buildLogicalTrades(allTrades, userId);
  if (!logical.length) {
    return res.status(200).json({ success: true, count: 0, warnings });
  }

  // Fetch plans and apply matching before insert — single insert, no update pass needed
  const { data: plannedTrades } = await supabaseAdmin
    .from('planned_trades')
    .select('*')
    .eq('user_id', userId);

  if (plannedTrades?.length) {
    applyPlanMatching(logical, plannedTrades);
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

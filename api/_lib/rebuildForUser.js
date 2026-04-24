'use strict';

const { buildLogicalTrades } = require('./logicalTradeBuilder');
const { computeAdherenceScore } = require('./adherenceScore');

// Match logical trades to plans in place. Returns plan-currency backfills that
// the caller is expected to persist. Mirrors the behaviour in api/rebuild.js
// so rebuildForUser + the HTTP rebuild endpoint produce identical output.
function applyPlanMatching(logicalTrades, plannedTrades) {
  const plansById = new Map();
  for (const pt of plannedTrades) plansById.set(pt.id, pt);
  const currencyBackfills = [];

  for (const lt of logicalTrades) {
    if (lt.user_reviewed) {
      if (lt.status === 'closed' && lt.planned_trade_id) {
        const plan = plansById.get(lt.planned_trade_id);
        if (plan) lt.adherence_score = computeAdherenceScore(plan, lt);
      }
      continue;
    }

    const matches = plannedTrades.filter(pt =>
      pt.symbol?.trim().toUpperCase() === lt.symbol?.trim().toUpperCase() &&
      pt.direction?.trim().toUpperCase() === lt.direction?.trim().toUpperCase() &&
      pt.asset_category?.trim().toUpperCase() === lt.asset_category?.trim().toUpperCase() &&
      pt.created_at && lt.opened_at &&
      new Date(pt.created_at).getTime() <= new Date(lt.opened_at).getTime()
    );

    if (matches.length === 1) {
      lt.matching_status = 'matched';
      lt.planned_trade_id = matches[0].id;
      if (lt.status === 'closed') {
        lt.adherence_score = computeAdherenceScore(matches[0], lt);
      }
      if (!matches[0].currency && lt.currency) {
        currencyBackfills.push({ planId: matches[0].id, currency: lt.currency });
        matches[0].currency = lt.currency;
      }
    } else if (matches.length === 0) {
      lt.matching_status = 'off_plan';
      lt.planned_trade_id = null;
      lt.adherence_score = null;
    } else {
      lt.matching_status = 'needs_review';
      lt.planned_trade_id = null;
      lt.adherence_score = null;
    }
  }
  return currencyBackfills;
}

// Full logical-trade rebuild for one user, using the service-role client.
// Returns { count, warnings } on success; throws on DB errors. The HTTP
// endpoint (api/rebuild.js) and the cron sync loop (api/cron-sync.js) both
// call this so rebuild logic lives in exactly one place.
async function rebuildForUser(userId, supabaseAdmin) {
  const { data: allTrades, error: fetchError } = await supabaseAdmin
    .from('trades')
    .select('*')
    .eq('user_id', userId)
    .order('date_time', { ascending: true });

  if (fetchError) {
    throw new Error(`Could not fetch trades: ${fetchError.message}`);
  }

  if (!allTrades?.length) {
    return { count: 0, warnings: [] };
  }

  const warnings = [];
  const missingFxRate = allTrades.filter(t => t.fx_rate_to_base == null).length;
  const missingCurrency = allTrades.filter(t => !t.currency).length;
  if (missingFxRate > 0) warnings.push(`${missingFxRate} trade(s) have no FX rate — run Sync Now to fix`);
  if (missingCurrency > 0) warnings.push(`${missingCurrency} trade(s) have no currency — run Sync Now to fix`);

  const { data: existingLogical } = await supabaseAdmin
    .from('logical_trades')
    .select('opening_ib_order_id, conid, review_notes, matching_status, planned_trade_id, user_reviewed')
    .eq('user_id', userId);

  const preservedByKey = new Map();
  for (const row of (existingLogical || [])) {
    if (!row.opening_ib_order_id) continue;
    const key = `${row.opening_ib_order_id}:${row.conid ?? ''}`;
    const isRealDecision = !!row.user_reviewed &&
      (row.matching_status === 'matched' || row.matching_status === 'off_plan');
    preservedByKey.set(key, {
      review_notes: row.review_notes || null,
      user_reviewed: isRealDecision,
      preserved_status: isRealDecision ? row.matching_status : null,
      preserved_planned_trade_id: isRealDecision ? row.planned_trade_id : null,
    });
  }

  const logical = buildLogicalTrades(allTrades, userId);
  if (!logical.length) {
    return { count: 0, warnings };
  }

  for (const lt of logical) {
    // Always explicitly set user_reviewed. buildLogicalTrades doesn't set
    // it, so without this the object has no such key -- and because
    // PostgREST batch inserts use the union of keys across rows, a single
    // preserved row with user_reviewed=true forces NULL into every other
    // row's user_reviewed slot instead of letting the DEFAULT false apply.
    // That violates the NOT NULL constraint added in
    // 20260417_collapse_matching_status_to_3_states.sql and the whole
    // insert 500s. Default explicitly here; the preserve branch below
    // flips it to true when we need to carry a user's decision across
    // rebuilds.
    lt.user_reviewed = false;

    if (!lt.opening_ib_order_id) continue;
    const key = `${lt.opening_ib_order_id}:${lt.conid ?? ''}`;
    const p = preservedByKey.get(key);
    if (!p) continue;
    if (p.review_notes) lt.review_notes = p.review_notes;
    if (p.user_reviewed) {
      lt.user_reviewed = true;
      lt.matching_status = p.preserved_status;
      lt.planned_trade_id = p.preserved_planned_trade_id;
    }
  }

  const { data: plannedTrades } = await supabaseAdmin
    .from('planned_trades')
    .select('*')
    .eq('user_id', userId);

  let currencyBackfills = [];
  if (plannedTrades?.length) {
    currencyBackfills = applyPlanMatching(logical, plannedTrades);
  }

  if (currencyBackfills.length > 0) {
    for (const { planId, currency } of currencyBackfills) {
      await supabaseAdmin
        .from('planned_trades')
        .update({ currency })
        .eq('id', planId)
        .eq('user_id', userId);
    }
  }

  const { error: deleteError } = await supabaseAdmin
    .from('logical_trades')
    .delete()
    .eq('user_id', userId);
  if (deleteError) throw new Error(`Could not clear old logical trades: ${deleteError.message}`);

  const { error: insertError } = await supabaseAdmin
    .from('logical_trades')
    .insert(logical);
  if (insertError) throw new Error(insertError.message);

  return { count: logical.length, warnings };
}

module.exports = { rebuildForUser };

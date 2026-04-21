// Builds per-day adherence aggregates from logical_trades for TradeSquares.
//
// Called by api/rebuild.js after logical_trades are inserted. Groups closed
// trades by the calendar date of `closed_at` (YYYY-MM-DD, UTC slice — same
// convention used everywhere else in the app) and computes:
//
//   adherence_score   = avg(adherence_score) across MATCHED closed trades
//                       NULL if the day has no matched closed trades
//   matched_count     = how many matched closed trades on that day
//   off_plan_count    = how many off-plan closed trades
//   needs_review_count= how many unresolved
//   trade_count       = total closed trades (matched + off_plan + needs_review)
//
// Why off-plan is excluded from the average (not zeroed):
//   An off-plan trade may be a legitimate opportunity that couldn't be
//   planned in advance. At the day level we don't want one such trade to
//   drag a disciplined day into red. The meta-pattern (habitually trading
//   off-plan) is caught separately by PerformanceScreen Rule 4.

function buildDailyAdherence(logicalTrades) {
  const byDay = new Map();

  for (const lt of logicalTrades) {
    if (lt.status !== 'closed') continue;
    if (!lt.closed_at) continue;
    const dateKey = lt.closed_at.slice(0, 10); // YYYY-MM-DD

    if (!byDay.has(dateKey)) {
      byDay.set(dateKey, {
        date_key: dateKey,
        adherence_sum: 0,
        adherence_count: 0,
        matched_count: 0,
        off_plan_count: 0,
        needs_review_count: 0,
        trade_count: 0,
      });
    }
    const bucket = byDay.get(dateKey);
    bucket.trade_count += 1;

    if (lt.matching_status === 'matched') {
      bucket.matched_count += 1;
      // adherence_score can be null on matched trades if the plan is
      // missing required fields — skip those too, don't let a null pull
      // the average toward zero.
      if (lt.adherence_score != null) {
        bucket.adherence_sum += Number(lt.adherence_score);
        bucket.adherence_count += 1;
      }
    } else if (lt.matching_status === 'off_plan') {
      bucket.off_plan_count += 1;
    } else if (lt.matching_status === 'needs_review') {
      bucket.needs_review_count += 1;
    }
  }

  const rows = [];
  for (const bucket of byDay.values()) {
    rows.push({
      date_key: bucket.date_key,
      adherence_score: bucket.adherence_count > 0
        ? Math.round((bucket.adherence_sum / bucket.adherence_count) * 10) / 10
        : null,
      matched_count: bucket.matched_count,
      off_plan_count: bucket.off_plan_count,
      needs_review_count: bucket.needs_review_count,
      trade_count: bucket.trade_count,
    });
  }
  return rows;
}

module.exports = { buildDailyAdherence };

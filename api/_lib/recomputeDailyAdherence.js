// Recompute the daily_adherence rollup for a single user.
//
// Reads every closed logical_trade for the user, buckets them by closed_at
// date (UTC), and writes one daily_adherence row per day with:
//   - adherence_score: avg(adherence_score) across matched trades that day
//   - matched_count: count of matching_status='matched'
//   - off_plan_count: count of matching_status='off_plan'
//   - needs_review_count: count of matching_status='needs_review'
//   - trade_count: total closed logicals on that day
//
// Strategy is wipe + reinsert (not upsert) — at ~365 rows/year max, the
// math is trivial and avoids reconciliation logic. Days with zero closed
// trades are skipped rather than written as zero rows.
//
// Called at the end of:
//   - api/rebuild.js (so manual rebuilds refresh the rollup)
//   - api/_lib/performUserSync.js (so each IBKR sync refreshes it)
//
// First consumer: PerformanceScreen. Future consumer: TradeSquares heatmap
// when it launches off the tradesquares branch. Decoupling the rollup from
// any specific UI means it's ready whenever any screen wants per-day data.

async function recomputeDailyAdherence(supabaseAdmin, userId) {
  // Pull only the fields we need. Closed-only — open trades have no settled
  // adherence yet (adherence_score is computed at close).
  const { data: logicals, error: fetchErr } = await supabaseAdmin
    .from('logical_trades')
    .select('closed_at, matching_status, adherence_score')
    .eq('user_id', userId)
    .eq('status', 'closed')
    .not('closed_at', 'is', null)

  if (fetchErr) {
    throw new Error(`recomputeDailyAdherence fetch: ${fetchErr.message}`)
  }

  // Bucket by date_key (YYYY-MM-DD in UTC). Postgres `date` type stores
  // calendar dates with no time component; matching to UTC keeps the
  // boundary stable regardless of where the trader lives.
  const byDay = new Map()
  for (const lt of logicals) {
    const dateKey = lt.closed_at.slice(0, 10) // ISO 'YYYY-MM-DDTHH:mm:ss...' → 'YYYY-MM-DD'
    if (!byDay.has(dateKey)) {
      byDay.set(dateKey, {
        adherenceSum: 0,
        adherenceCount: 0, // matched-with-score only
        matched: 0,
        offPlan: 0,
        needsReview: 0,
        total: 0,
      })
    }
    const day = byDay.get(dateKey)
    day.total++
    if (lt.matching_status === 'matched') {
      day.matched++
      if (lt.adherence_score != null) {
        day.adherenceSum += parseFloat(lt.adherence_score)
        day.adherenceCount++
      }
    } else if (lt.matching_status === 'off_plan') {
      day.offPlan++
    } else if (lt.matching_status === 'needs_review') {
      day.needsReview++
    }
  }

  const rows = []
  for (const [dateKey, day] of byDay) {
    rows.push({
      user_id: userId,
      date_key: dateKey,
      // Avg only across matched-with-score trades. Days with matched trades
      // but null scores get null adherence_score (rare; usually means a
      // matched trade lacks a planned exit/entry to score against).
      adherence_score: day.adherenceCount > 0
        ? day.adherenceSum / day.adherenceCount
        : null,
      matched_count: day.matched,
      off_plan_count: day.offPlan,
      needs_review_count: day.needsReview,
      trade_count: day.total,
    })
  }

  // Wipe + reinsert. Conditional on rows.length so we don't hit Postgres with
  // an empty insert array (Supabase tolerates it, but skipping is cleaner).
  const { error: wipeErr } = await supabaseAdmin
    .from('daily_adherence')
    .delete()
    .eq('user_id', userId)
  if (wipeErr) throw new Error(`recomputeDailyAdherence wipe: ${wipeErr.message}`)

  if (rows.length > 0) {
    const { error: insertErr } = await supabaseAdmin
      .from('daily_adherence')
      .insert(rows)
    if (insertErr) throw new Error(`recomputeDailyAdherence insert: ${insertErr.message}`)
  }

  return { dayCount: rows.length }
}

module.exports = { recomputeDailyAdherence }

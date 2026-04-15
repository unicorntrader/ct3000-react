/**
 * Computes an adherence breakdown comparing a planned trade to what actually
 * happened. Returns FOUR sub-scores plus the overall average:
 *
 *   { entry, target, stop, size, overall }
 *
 * Each sub-score is 0–100 or null (null = "plan didn't specify that field,
 * we can't score it — skip it in the average"). The `overall` is the simple
 * average of whichever sub-scores are non-null, rounded to one decimal.
 *
 * Callers that just want a single number use `.overall`. Callers that want
 * to decompose (the Performance Review panel) use the sub-scores directly.
 *
 * Returns null if no sub-score can be computed at all.
 */
export function computeAdherenceBreakdown(plan, trade) {
  if (!plan || !trade) return null

  const plannedEntry  = plan.planned_entry_price
  const plannedTarget = plan.planned_target_price
  const plannedStop   = plan.planned_stop_loss
  const plannedQty    = plan.planned_quantity

  const actualEntry  = trade.avg_entry_price
  const actualQty    = trade.total_closing_quantity || trade.total_opening_quantity
  const direction    = trade.direction // 'LONG' | 'SHORT'

  // Derive actual exit from native-currency P&L
  const closingQty = trade.total_closing_quantity || trade.total_opening_quantity
  let actualExit = null
  if (actualEntry != null && closingQty > 0 && trade.total_realized_pnl != null) {
    actualExit = direction === 'LONG'
      ? actualEntry + (trade.total_realized_pnl / closingQty)
      : actualEntry - (trade.total_realized_pnl / closingQty)
  }

  // ── Entry: 1% slippage = 5pt deduction, max 100pt ───────────────────────
  let entry = null
  if (plannedEntry != null && actualEntry != null) {
    const slippage = Math.abs(actualEntry - plannedEntry) / plannedEntry * 100
    entry = Math.max(0, 100 - Math.min(100, slippage * 5))
  }

  // ── Target: at/beyond target = 100, linear between entry and target, ────
  //            exited against trade = 0
  let target = null
  if (plannedTarget != null && actualEntry != null && actualExit != null) {
    let score
    if (direction === 'LONG') {
      if (actualExit >= plannedTarget) {
        score = 100
      } else if (actualExit > actualEntry) {
        score = (actualExit - actualEntry) / (plannedTarget - actualEntry) * 100
      } else {
        score = 0
      }
    } else {
      if (actualExit <= plannedTarget) {
        score = 100
      } else if (actualExit < actualEntry) {
        score = (actualEntry - actualExit) / (actualEntry - plannedTarget) * 100
      } else {
        score = 0
      }
    }
    target = Math.max(0, Math.min(100, score))
  }

  // ── Stop: respected = 100, violated = 0 ─────────────────────────────────
  let stop = null
  if (plannedStop != null && actualExit != null) {
    const respected = direction === 'LONG'
      ? actualExit >= plannedStop
      : actualExit <= plannedStop
    stop = respected ? 100 : 0
  }

  // ── Quantity: proportional deduction for deviation ──────────────────────
  let size = null
  if (plannedQty != null && actualQty != null) {
    const diff = Math.abs(actualQty - plannedQty) / plannedQty * 100
    size = Math.max(0, 100 - Math.min(100, diff))
  }

  const scored = [entry, target, stop, size].filter(v => v != null)
  if (scored.length === 0) return null

  const avg = scored.reduce((a, b) => a + b, 0) / scored.length
  const overall = Math.round(avg * 10) / 10

  return { entry, target, stop, size, overall }
}

/**
 * Backward-compatible scalar shortcut. Returns just the `overall` number
 * (or null) so legacy callers that imported `computeAdherenceScore` don't
 * need to change shape immediately.
 */
export function computeAdherenceScore(plan, trade) {
  const b = computeAdherenceBreakdown(plan, trade)
  return b == null ? null : b.overall
}

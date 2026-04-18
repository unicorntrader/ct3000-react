/**
 * Computes a 0–100 adherence score comparing a planned trade to what actually
 * happened. Four sub-scores (entry slippage, target capture, stop respect,
 * quantity deviation) averaged into an overall number. Returns null if not a
 * single sub-score can be computed (no entry info, no exit info, etc).
 *
 * Called only by api/rebuild.js — the result is written to
 * logical_trades.adherence_score and read directly by the browser (Journal,
 * TradeInlineDetail, PerformanceScreen). No client-side mirror of this file.
 *
 * If you want the per-pillar breakdown back (entry / target / stop / size),
 * see git history for the 5-field version — it was removed April 2026
 * alongside PerformanceScreen's breakdown panel.
 */
function computeAdherenceScore(plan, trade) {
  if (!plan || !trade) return null;

  const plannedEntry  = plan.planned_entry_price;
  const plannedTarget = plan.planned_target_price;
  const plannedStop   = plan.planned_stop_loss;
  const plannedQty    = plan.planned_quantity;

  const actualEntry = trade.avg_entry_price;
  const actualQty   = trade.total_closing_quantity || trade.total_opening_quantity;
  const direction   = trade.direction; // 'LONG' | 'SHORT'

  // Derive actual exit from native-currency P&L
  const closingQty = trade.total_closing_quantity || trade.total_opening_quantity;
  let actualExit = null;
  if (actualEntry != null && closingQty > 0 && trade.total_realized_pnl != null) {
    actualExit = direction === 'LONG'
      ? actualEntry + (trade.total_realized_pnl / closingQty)
      : actualEntry - (trade.total_realized_pnl / closingQty);
  }

  // Entry: 1% slippage = 5pt deduction, max 100pt
  let entry = null;
  if (plannedEntry != null && actualEntry != null) {
    const slippage = Math.abs(actualEntry - plannedEntry) / plannedEntry * 100;
    entry = Math.max(0, 100 - Math.min(100, slippage * 5));
  }

  // Target: at/beyond target = 100, linear between entry and target,
  //         exited against trade = 0
  let target = null;
  if (plannedTarget != null && actualEntry != null && actualExit != null) {
    let score;
    if (direction === 'LONG') {
      if (actualExit >= plannedTarget) {
        score = 100;
      } else if (actualExit > actualEntry) {
        score = (actualExit - actualEntry) / (plannedTarget - actualEntry) * 100;
      } else {
        score = 0;
      }
    } else {
      if (actualExit <= plannedTarget) {
        score = 100;
      } else if (actualExit < actualEntry) {
        score = (actualEntry - actualExit) / (actualEntry - plannedTarget) * 100;
      } else {
        score = 0;
      }
    }
    target = Math.max(0, Math.min(100, score));
  }

  // Stop: respected = 100, violated = 0
  let stop = null;
  if (plannedStop != null && actualExit != null) {
    const respected = direction === 'LONG'
      ? actualExit >= plannedStop
      : actualExit <= plannedStop;
    stop = respected ? 100 : 0;
  }

  // Quantity: proportional deduction for deviation
  let size = null;
  if (plannedQty != null && actualQty != null) {
    const diff = Math.abs(actualQty - plannedQty) / plannedQty * 100;
    size = Math.max(0, 100 - Math.min(100, diff));
  }

  const scored = [entry, target, stop, size].filter(v => v != null);
  if (scored.length === 0) return null;

  const avg = scored.reduce((a, b) => a + b, 0) / scored.length;
  return Math.round(avg * 10) / 10;
}

module.exports = { computeAdherenceScore };

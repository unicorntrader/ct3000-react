/**
 * CommonJS copy of src/lib/adherenceScore.js — consumed by api/rebuild.js.
 * Keep in sync with the ES module version. If you change one, change both.
 *
 * Computes an adherence score (0–100) comparing a planned trade to what
 * actually happened. Only scores fields that exist on the plan — never
 * penalises for missing fields. Returns null if no scoreable fields exist.
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

  const scores = [];

  // Entry: 1% slippage = 5pt deduction, max 100pt
  if (plannedEntry != null && actualEntry != null) {
    const slippage = Math.abs(actualEntry - plannedEntry) / plannedEntry * 100;
    scores.push(Math.max(0, 100 - Math.min(100, slippage * 5)));
  }

  // Target: at/beyond target = 100, linear between entry and target,
  //         exited against trade = 0
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
    scores.push(Math.max(0, Math.min(100, score)));
  }

  // Stop: respected = 100, violated = 0
  if (plannedStop != null && actualExit != null) {
    const respected = direction === 'LONG'
      ? actualExit >= plannedStop
      : actualExit <= plannedStop;
    scores.push(respected ? 100 : 0);
  }

  // Quantity: proportional deduction for deviation
  if (plannedQty != null && actualQty != null) {
    const diff = Math.abs(actualQty - plannedQty) / plannedQty * 100;
    scores.push(Math.max(0, 100 - Math.min(100, diff)));
  }

  if (scores.length === 0) return null;

  const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
  return Math.round(avg * 10) / 10;
}

module.exports = { computeAdherenceScore };

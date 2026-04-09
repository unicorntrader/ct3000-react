/**
 * matchPlansToTrades
 * Input: 
 *   - logicalTrades: array from logical_trades table
 *   - plannedTrades: array from planned_trades table
 * Output: array of updates to apply to logical_trades
 * 
 * Matching criteria (all 3 must match):
 *   1. symbol
 *   2. direction (LONG/SHORT)
 *   3. asset_category (STK/OPT/FXCFD/CASH)
 * 
 * Results:
 *   - 1 match  → matched
 *   - 0 matches → unmatched (review queue)
 *   - 2+ matches → ambiguous (review queue)
 */

export function matchPlansToTrades(logicalTrades, plannedTrades) {
  const updates = [];

  for (const lt of logicalTrades) {
    // Skip trades already manually reviewed
    if (lt.matching_status === 'manual') continue;

    const matches = plannedTrades.filter(pt =>
      pt.symbol?.trim().toUpperCase() === lt.symbol?.trim().toUpperCase() &&
      pt.direction?.trim().toUpperCase() === lt.direction?.trim().toUpperCase() &&
      pt.asset_category?.trim().toUpperCase() === lt.asset_category?.trim().toUpperCase()
    );

    if (matches.length === 1) {
      updates.push({
        id: lt.id,
        matching_status: 'matched',
        planned_trade_id: matches[0].id,
      });
    } else if (matches.length === 0) {
      updates.push({
        id: lt.id,
        matching_status: 'unmatched',
        planned_trade_id: null,
      });
    } else {
      // 2+ matches — ambiguous, goes to review queue
      updates.push({
        id: lt.id,
        matching_status: 'ambiguous',
        planned_trade_id: null,
      });
    }
  }

  return updates;
}

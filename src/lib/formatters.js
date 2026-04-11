/**
 * Converts a logical trade's P&L to base currency.
 * Uses the fx_rate_to_base recorded by IBKR at execution time.
 */
export const pnlBase = (t) => (t.total_realized_pnl || 0) * (t.fx_rate_to_base || 1);

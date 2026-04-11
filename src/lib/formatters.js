/**
 * Converts a logical trade's P&L to base currency.
 * Uses the fx_rate_to_base recorded by IBKR at execution time.
 */
export const pnlBase = (t) => (t.total_realized_pnl || 0) * (t.fx_rate_to_base || 1);

export const currencySymbol = (c) => {
  switch (c) {
    case 'USD': return '$';
    case 'JPY': return '¥';
    case 'EUR': return '€';
    case 'GBP': return '£';
    default: return c ? c + ' ' : '$';
  }
};

/** Price with currency symbol, e.g. "$1,234.56" */
export const fmtPrice = (n, currency = 'USD') => {
  if (n == null) return '—';
  return currencySymbol(currency) + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

/** Signed P&L with currency symbol, e.g. "+$1,234.56" or "-¥500.00"
 *  Pass decimals=0 for whole-number display: "+$1,234" */
export const fmtPnl = (n, currency = 'USD', decimals = 2) => {
  if (n == null) return '—';
  const sym = currencySymbol(currency);
  const abs = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  return (n >= 0 ? '+' : '-') + sym + abs;
};

/** Compact signed P&L for chart axes, e.g. "+$1.2k" */
export const fmtShort = (n, currency = 'USD') => {
  if (n == null || isNaN(n)) return '—';
  const sym = currencySymbol(currency);
  const abs = Math.abs(n);
  const sign = n >= 0 ? '+' : '-';
  if (abs >= 1000) return sign + sym + (abs / 1000).toFixed(1) + 'k';
  return sign + sym + abs.toFixed(0);
};

/** Short date, no year: "Apr 11" */
export const fmtDate = (iso) => {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

/** Long date with year: "Apr 11, 2026" */
export const fmtDateLong = (iso) => {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

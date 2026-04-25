/**
 * Converts a logical trade's P&L to base currency.
 * Uses the fx_rate_to_base recorded by IBKR at execution time.
 */
export const pnlBase = (t) => (t.total_realized_pnl || 0) * (t.fx_rate_to_base || 1);

/**
 * Maps a currency code to its display symbol.
 * Returns '¤' (the generic currency sign) when currency is missing — this
 * makes any forgotten-argument call site immediately visible in the UI as
 * "¤1,234.56" instead of silently defaulting to '$'.
 *
 * RULE: every fmtPnl / fmtPrice call MUST pass an explicit currency.
 *   - Single trade → trade.currency (native)
 *   - Aggregate    → baseCurrency from useBaseCurrency() context
 */
export const currencySymbol = (c) => {
  switch (c) {
    case 'USD': return '$';
    case 'JPY': return '¥';
    case 'EUR': return '€';
    case 'GBP': return '£';
    case 'CHF': return 'CHF ';
    case 'CAD': return 'C$';
    case 'AUD': return 'A$';
    case 'HKD': return 'HK$';
    case 'SGD': return 'S$';
    default: return c ? c + ' ' : '¤';
  }
};

/** Price with currency symbol, e.g. "£1,234.56". Currency is REQUIRED. */
export const fmtPrice = (n, currency) => {
  if (n == null) return '—';
  return currencySymbol(currency) + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

/** Signed P&L with currency symbol, e.g. "+£1,234". Currency is REQUIRED.
 *  Defaults to whole-number display. Pass decimals=2 if you need "+£1,234.56". */
export const fmtPnl = (n, currency, decimals = 0) => {
  if (n == null) return '—';
  const sym = currencySymbol(currency);
  const abs = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  return (n >= 0 ? '+' : '-') + sym + abs;
};

/**
 * Quantity / share count display.
 *
 *   < 10,000  → standard locale: "30", "1,234", "9,999"
 *   ≥ 10,000  → compact: "10K", "40K", "1.25M", "2.3B"
 *
 * Why compact for large quantities: FX positions are sized in raw currency
 * units (40,000 USD, 100,000 EUR) — an order of magnitude larger than
 * typical equity share counts. Without compact notation, an FX row blows
 * out the column layout next to a stock row showing "30". Compact at ≥10K
 * keeps everyday equity quantities pristine while taming the FX numbers.
 *
 * Returns '—' for null / undefined / NaN.
 */
export const fmtQty = (n) => {
  if (n == null || isNaN(n)) return '—';
  const num = Number(n);
  const abs = Math.abs(num);
  if (abs < 10000) return num.toLocaleString('en-US');
  return num.toLocaleString('en-US', {
    notation: 'compact',
    maximumFractionDigits: 2,
  });
};

/** Compact signed P&L for chart axes, e.g. "+€1.2k". Currency is REQUIRED. */
export const fmtShort = (n, currency) => {
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

/**
 * Human-friendly symbol display.
 *
 * IBKR emits options in OSI format inside the `symbol` column, e.g.
 *   "NVDA 260330P00170000"
 *      └─┬─┘ └──┬──┘│└──┬──┘
 *        │     │   │   └── strike × 1000 (00170000 → $170.00)
 *        │     │   └────── C or P (call / put)
 *        │     └────────── YYMMDD expiry (260330 → 30 Mar 2026)
 *        └──────────────── underlying
 *
 * For options we return e.g. "NVDA 170P 30 Mar" — readable at a glance.
 * For stocks, FX, futures, cash: return the symbol unchanged.
 *
 * Pass a trade-like object (`{ symbol, asset_category }`) or just a string.
 */
const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

export const fmtSymbol = (tradeOrSymbol) => {
  if (!tradeOrSymbol) return '—';
  const symbol = typeof tradeOrSymbol === 'string' ? tradeOrSymbol : tradeOrSymbol.symbol;
  const asset  = typeof tradeOrSymbol === 'string' ? null : tradeOrSymbol.asset_category;
  if (!symbol) return '—';

  // Only try OSI parsing for OPT asset category (or if we're not told and it looks like OSI)
  if (asset && asset !== 'OPT') return symbol;

  const m = symbol.match(/^(\S+)\s+(\d{6})([CP])(\d{8})$/);
  if (!m) return symbol; // not OSI — return as-is (STK, FX, etc.)

  const [, underlying, yymmdd, cp, strikeRaw] = m;
  const dd = yymmdd.slice(4, 6);
  const mm = parseInt(yymmdd.slice(2, 4), 10);
  const monthName = MONTH_NAMES[mm - 1] || '';
  const strike = parseInt(strikeRaw, 10) / 1000;
  // Strip trailing zeros: 170.000 → "170", 127.500 → "127.5"
  const strikeStr = Number(strike.toFixed(3)).toString();

  return `${underlying} ${strikeStr}${cp} ${parseInt(dd, 10)} ${monthName}`;
};

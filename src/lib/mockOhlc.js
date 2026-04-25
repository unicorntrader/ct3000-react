// Synthetic OHLC bar generator for the trade-review chart.
//
// PURPOSE: until we wire a real provider (Alpaca free tier — see ROADMAP),
// the chart panel needs *something* to render. We synthesise bars that:
//
//   1. Cover the trade's opened_at → closed_at window plus padding on
//      each side (so entry/exit markers don't sit at the edges).
//   2. Walk from avg_entry_price to avg_exit_price during the hold,
//      so the entry/exit markers actually land on the price they should.
//   3. Pick a sane bar interval based on hold duration.
//
// The math is intentionally toy-grade — this is for visual-shape review,
// not statistical fidelity. When we swap in real data, this file gets
// deleted and TradeChartPanel calls /api/ohlc instead.

// Available timeframes the user can pick from. Order matters — the
// timeframe selector renders them left-to-right in this order.
export const TIMEFRAMES = [
  { label: '1m', seconds: 60 },
  { label: '5m', seconds: 5 * 60 },
  { label: '15m', seconds: 15 * 60 },
  { label: '1h', seconds: 60 * 60 },
  { label: '1D', seconds: 24 * 60 * 60 },
];

// Auto-pick a sensible default interval given how long the user held
// the trade. Caller can override this with an explicit interval.
//   < 2h    → 1-minute bars
//   < 1d    → 5-minute bars
//   < 1w    → 1-hour bars
//   ≥ 1w    → 1-day bars
export function pickAutoInterval(holdMs) {
  const HOUR = 60 * 60 * 1000;
  const DAY = 24 * HOUR;
  if (holdMs < 2 * HOUR) return TIMEFRAMES[0];
  if (holdMs < DAY) return TIMEFRAMES[1];
  if (holdMs < 7 * DAY) return TIMEFRAMES[3];
  return TIMEFRAMES[4];
}

// Stable pseudo-random in [-1, 1] given an integer index — so the chart
// doesn't reshuffle on every re-render.
function noise(i, salt) {
  const x = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453;
  return (x - Math.floor(x)) * 2 - 1;
}

/**
 * Generate synthetic candles around a trade's actual entry/exit.
 *
 * @param {object} trade  logical_trades row (or close enough — we read
 *                        opened_at, closed_at, avg_entry_price,
 *                        avg_exit_price, direction)
 * @param {{seconds:number,label:string}} [interval]  optional explicit
 *                        bar interval. If omitted, auto-pick from hold.
 * @returns {{
 *   bars: {time:number,open:number,high:number,low:number,close:number}[],
 *   entryTime: number,
 *   exitTime: number,
 *   intervalLabel: string,
 * }}
 */
export function generateMockOhlc(trade, interval = null) {
  const openedAt = trade.opened_at ? new Date(trade.opened_at).getTime() : null;
  const closedAt = trade.closed_at ? new Date(trade.closed_at).getTime() : null;
  if (!openedAt || !closedAt) return null;

  const entryPrice = parseFloat(trade.avg_entry_price);
  let exitPrice = trade.avg_exit_price != null ? parseFloat(trade.avg_exit_price) : null;
  if (exitPrice == null && trade.total_realized_pnl != null && trade.total_closing_quantity > 0) {
    const mult = parseFloat(trade.multiplier) || 1;
    exitPrice = trade.direction === 'LONG'
      ? entryPrice + trade.total_realized_pnl / (trade.total_closing_quantity * mult)
      : entryPrice - trade.total_realized_pnl / (trade.total_closing_quantity * mult);
  }
  if (!entryPrice || !exitPrice) return null;

  const hold = Math.max(closedAt - openedAt, 60 * 1000);
  const chosen = interval || pickAutoInterval(hold);
  const stepSec = chosen.seconds;
  const intervalLabel = chosen.label;
  const stepMs = stepSec * 1000;

  // Pad ~30% before and after the trade window so markers aren't at edges.
  const pad = Math.max(hold * 0.3, stepMs * 6);
  const startMs = openedAt - pad;
  const endMs = closedAt + pad;

  // Snap to the bar interval so candles align cleanly.
  const startTs = Math.floor(startMs / stepMs) * stepMs;
  const endTs = Math.ceil(endMs / stepMs) * stepMs;

  // Volatility — scaled to entry price so percent-moves look right.
  const vol = entryPrice * 0.005;

  const bars = [];
  let entryTime = null;
  let exitTime = null;
  let prevClose = entryPrice + noise(0, 7) * vol * 2;

  for (let i = 0, t = startTs; t <= endTs; i++, t += stepMs) {
    const timeSec = Math.floor(t / 1000);

    // Pin entryTime / exitTime to the nearest bar.
    if (entryTime == null && t >= openedAt) entryTime = timeSec;
    if (exitTime == null && t >= closedAt) exitTime = timeSec;

    // Anchor: where should this bar's close gravitate?
    let anchor;
    if (t < openedAt) {
      anchor = entryPrice;
    } else if (t > closedAt) {
      anchor = exitPrice;
    } else {
      const f = (t - openedAt) / Math.max(closedAt - openedAt, 1);
      anchor = entryPrice + (exitPrice - entryPrice) * f;
    }

    const open = prevClose;
    const close = anchor + noise(i, 13) * vol * 1.4;
    const high = Math.max(open, close) + Math.abs(noise(i, 31)) * vol * 1.1;
    const low = Math.min(open, close) - Math.abs(noise(i, 53)) * vol * 1.1;

    bars.push({
      time: timeSec,
      open: +open.toFixed(2),
      high: +high.toFixed(2),
      low: +low.toFixed(2),
      close: +close.toFixed(2),
    });
    prevClose = close;
  }

  // Fallbacks in case the loop didn't pin them (e.g. zero-length hold).
  if (entryTime == null && bars.length) entryTime = bars[Math.floor(bars.length * 0.3)].time;
  if (exitTime == null && bars.length) exitTime = bars[Math.floor(bars.length * 0.7)].time;

  return { bars, entryTime, exitTime, intervalLabel };
}

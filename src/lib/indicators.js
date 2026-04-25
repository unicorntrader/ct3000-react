// Pure indicator helpers. Each takes a bar array
// (`[{ time, open, high, low, close, volume }]`) and returns line-series
// data (`[{ time, value }]`). Skip leading bars where the indicator isn't
// defined — lightweight-charts handles gaps fine.
//
// We compute these client-side instead of pulling from the API so the
// chart doesn't hammer Alpaca with a separate request per indicator.
// All functions are O(n) and run in well under a millisecond on the
// ~600-bar series we ship.

export function sma(bars, period) {
  if (!bars?.length || period < 1) return []
  const out = []
  let sum = 0
  for (let i = 0; i < bars.length; i++) {
    sum += bars[i].close
    if (i >= period) sum -= bars[i - period].close
    if (i >= period - 1) out.push({ time: bars[i].time, value: sum / period })
  }
  return out
}

export function ema(bars, period) {
  if (!bars?.length || period < 1) return []
  const k = 2 / (period + 1)
  const out = []
  let prev = null
  // Seed with SMA over the first `period` bars so the EMA isn't dragged
  // by an arbitrary first close.
  for (let i = 0; i < bars.length; i++) {
    if (i < period - 1) continue
    if (i === period - 1) {
      let sum = 0
      for (let j = 0; j < period; j++) sum += bars[j].close
      prev = sum / period
    } else {
      prev = bars[i].close * k + prev * (1 - k)
    }
    out.push({ time: bars[i].time, value: prev })
  }
  return out
}

// Bollinger Bands: middle = SMA(period), upper/lower = middle ± stdMult·σ
// computed over the same window. Returns three series.
export function bollinger(bars, period = 20, stdMult = 2) {
  if (!bars?.length || period < 2) return { upper: [], middle: [], lower: [] }
  const upper = []
  const middle = []
  const lower = []
  for (let i = period - 1; i < bars.length; i++) {
    let sum = 0
    for (let j = i - period + 1; j <= i; j++) sum += bars[j].close
    const mean = sum / period
    let sqSum = 0
    for (let j = i - period + 1; j <= i; j++) {
      const d = bars[j].close - mean
      sqSum += d * d
    }
    const stddev = Math.sqrt(sqSum / period)
    const t = bars[i].time
    middle.push({ time: t, value: mean })
    upper.push({ time: t, value: mean + stdMult * stddev })
    lower.push({ time: t, value: mean - stdMult * stddev })
  }
  return { upper, middle, lower }
}

// Volume-weighted average price, anchored to the first bar in the series.
// For intraday charts you'd typically anchor at session open; for trade
// review the start of the visible window is a fine reference.
export function vwap(bars) {
  if (!bars?.length) return []
  const out = []
  let cumPV = 0
  let cumV = 0
  for (const bar of bars) {
    const typical = (bar.high + bar.low + bar.close) / 3
    const v = bar.volume || 0
    cumPV += typical * v
    cumV += v
    if (cumV > 0) out.push({ time: bar.time, value: cumPV / cumV })
  }
  return out
}

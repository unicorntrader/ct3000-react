// Client-side wrapper around /api/ohlc.
//
// Computes a sensible bar-window for a given trade + timeframe (matches the
// padding the chart's visible-range logic expects) and asks the server for
// real Alpaca bars. If Alpaca has no data for the symbol (options, futures,
// some non-US tickers) we fall back to the synthetic generator so the user
// still sees *something* — clearly tagged as synthetic in the UI.

import { supabase } from './supabaseClient'
import { generateMockOhlc } from './mockOhlc'

// Compute the [from, to] window we ask Alpaca for. Mirrors mockOhlc's pad
// rules so the visible-range logic in TradeChartPanel still has enough
// surrounding bars to work with.
function computeWindow(trade, interval) {
  const openedAt = new Date(trade.opened_at).getTime()
  const closedAt = new Date(trade.closed_at).getTime()
  const hold = Math.max(closedAt - openedAt, 60 * 1000)
  const stepMs = interval.seconds * 1000

  const MAX_BARS = 600
  const holdBars = Math.ceil(hold / stepMs)

  let padBefore = Math.max(hold * 0.5, stepMs * 30)
  let padAfter = Math.max(hold * 0.2, stepMs * 10)
  let totalBars = holdBars + Math.ceil(padBefore / stepMs) + Math.ceil(padAfter / stepMs)
  if (totalBars > MAX_BARS) {
    const extraBudget = Math.max(MAX_BARS - holdBars, 20)
    const beforeShare = Math.floor(extraBudget * 0.7)
    const afterShare = extraBudget - beforeShare
    padBefore = beforeShare * stepMs
    padAfter = afterShare * stepMs
  }
  return {
    from: new Date(openedAt - padBefore).toISOString(),
    to: new Date(closedAt + padAfter).toISOString(),
  }
}

// Resolve `entryTime` / `exitTime` to the closest bar timestamps in the
// returned series so markers land on a candle, not in dead space.
function snapToNearestBar(bars, targetMs) {
  if (!bars.length) return null
  const targetSec = Math.floor(targetMs / 1000)
  let best = bars[0]
  let bestDelta = Math.abs(bars[0].time - targetSec)
  for (const bar of bars) {
    const delta = Math.abs(bar.time - targetSec)
    if (delta < bestDelta) {
      best = bar
      bestDelta = delta
    }
  }
  return best.time
}

/**
 * Fetch OHLC bars for a trade. Falls back to synthetic if Alpaca has
 * no data for the symbol.
 *
 * @returns {{ bars, entryTime, exitTime, intervalLabel, source }}
 *          source: 'alpaca' | 'synthetic'
 */
export async function fetchOhlcForTrade(trade, interval, { signal } = {}) {
  if (!trade?.opened_at || !trade?.closed_at || !trade?.symbol) return null
  const openedAt = new Date(trade.opened_at).getTime()
  const closedAt = new Date(trade.closed_at).getTime()
  const { from, to } = computeWindow(trade, interval)

  let bars = []
  let source = 'synthetic'
  let fallbackReason = null
  try {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.access_token) throw new Error('not authenticated')

    const params = new URLSearchParams({
      symbol: trade.symbol,
      timeframe: interval.label,
      from,
      to,
    })
    const res = await fetch(`/api/ohlc?${params.toString()}`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
      signal,
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`HTTP ${res.status}${body ? `: ${body.slice(0, 120)}` : ''}`)
    }
    const json = await res.json()
    if (json.source === 'alpaca' && Array.isArray(json.bars) && json.bars.length) {
      bars = json.bars
      source = 'alpaca'
    } else {
      fallbackReason = json.reason || `Alpaca returned ${Array.isArray(json.bars) ? json.bars.length : 0} bars`
    }
  } catch (err) {
    if (err.name === 'AbortError') throw err
    fallbackReason = err?.message || 'unknown error'
    console.warn('[ohlc] real fetch failed, falling back to synthetic:', fallbackReason)
  }

  if (!bars.length) {
    const mock = generateMockOhlc(trade, interval)
    if (!mock) return null
    return { ...mock, source: 'synthetic', fallbackReason }
  }

  return {
    bars,
    entryTime: snapToNearestBar(bars, openedAt),
    exitTime: snapToNearestBar(bars, closedAt),
    intervalLabel: interval.label,
    source,
  }
}

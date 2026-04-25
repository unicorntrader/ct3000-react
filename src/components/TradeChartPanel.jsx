import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  createChart,
  CandlestickSeries,
  AreaSeries,
  LineStyle,
  createSeriesMarkers,
  createTextWatermark,
} from 'lightweight-charts'
import { generateMockOhlc, pickAutoInterval, TIMEFRAMES } from '../lib/mockOhlc'
import { fmtSymbol, fmtPrice } from '../lib/formatters'

// Trade-review chart panel rendered inside TradeInlineDetail when the user
// clicks "Show chart". Uses TradingView Lightweight Charts (v5) with
// synthetic OHLC data — when /api/ohlc lands (Alpaca-backed), swap the
// generateMockOhlc call for a real fetch.
//
// Conventions follow the v5 official guide:
//   * chart.addSeries(CandlestickSeries, { borderVisible: false, ... })
//   * Hold-window AreaSeries lives on its own overlay scale so it doesn't
//     poison the candle scale (zero baseline would crush the candles).
//   * createSeriesMarkers(series, []) instead of v4's series.setMarkers.
//   * createTextWatermark(pane, { lines }) instead of a manual overlay div
//     that gets clipped by the price scale column.

export default function TradeChartPanel({ trade, plan }) {
  const containerRef = useRef(null)
  const chartRef = useRef(null)
  const [error, setError] = useState(null)

  // Default timeframe = auto-pick. User can override via the toolbar
  // buttons. Switching TF regenerates synthetic data; with real Alpaca
  // data later, this state will drive a refetch instead.
  const autoInterval = useMemo(() => {
    if (!trade?.opened_at || !trade?.closed_at) return TIMEFRAMES[1]
    const hold = new Date(trade.closed_at).getTime() - new Date(trade.opened_at).getTime()
    return pickAutoInterval(Math.max(hold, 60 * 1000))
  }, [trade?.opened_at, trade?.closed_at])

  const [barInterval, setBarInterval] = useState(autoInterval)
  // Reset selected barInterval when the trade changes
  useEffect(() => { setBarInterval(autoInterval) }, [autoInterval])

  useEffect(() => {
    if (!containerRef.current || !trade) return

    let chart
    try {
      const data = generateMockOhlc(trade, barInterval)
      if (!data || !data.bars.length) {
        setError('Not enough data to render this trade.')
        return
      }

      chart = createChart(containerRef.current, {
        height: 380,
        autoSize: true,
        layout: {
          background: { type: 'solid', color: '#ffffff' },
          textColor: '#374151',
          fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        },
        grid: {
          vertLines: { color: '#f3f4f6' },
          horzLines: { color: '#f3f4f6' },
        },
        rightPriceScale: {
          borderColor: '#e5e7eb',
          scaleMargins: { top: 0.08, bottom: 0.08 },
        },
        timeScale: {
          borderColor: '#e5e7eb',
          timeVisible: barInterval.label !== '1D',
          secondsVisible: false,
        },
        crosshair: { mode: 1 },
      })
      chartRef.current = chart

      // ── CT3000 watermark (v5 official plugin) ──────────────────────────
      // Uses createTextWatermark so the brand text is rendered inside the
      // chart's drawing surface, never clipped by the price scale column.
      const firstPane = chart.panes()[0]
      if (firstPane) {
        createTextWatermark(firstPane, {
          horzAlign: 'center',
          vertAlign: 'center',
          lines: [
            { text: 'CT3000', color: 'rgba(30, 64, 175, 0.10)', fontSize: 56, lineHeight: 60 },
            { text: 'PLAN YOUR TRADE · TRADE YOUR PLAN', color: 'rgba(30, 64, 175, 0.10)', fontSize: 11 },
          ],
        })
      }

      // ── Candlestick series (v5 canonical setup) ────────────────────────
      const candles = chart.addSeries(CandlestickSeries, {
        upColor: '#10b981',
        downColor: '#ef4444',
        wickUpColor: '#10b981',
        wickDownColor: '#ef4444',
        borderVisible: false,
      })
      candles.setData(data.bars)

      // ── Actual entry / exit reference lines ────────────────────────────
      // Faint dashed lines at the user's avg fill prices. Always shown,
      // even when there's no plan — gives the chart an axis reference.
      const entryPrice = parseFloat(trade.avg_entry_price)
      const exitPrice = trade.avg_exit_price != null ? parseFloat(trade.avg_exit_price) : null
      if (entryPrice) {
        candles.createPriceLine({
          price: entryPrice,
          color: 'rgba(16, 185, 129, 0.55)',
          lineWidth: 1,
          lineStyle: LineStyle.Dotted,
          axisLabelVisible: true,
          title: 'Entry',
        })
      }
      if (exitPrice) {
        candles.createPriceLine({
          price: exitPrice,
          color: 'rgba(239, 68, 68, 0.55)',
          lineWidth: 1,
          lineStyle: LineStyle.Dotted,
          axisLabelVisible: true,
          title: 'Exit',
        })
      }

      // ── Plan reference lines — only fields actually on the plan ────────
      if (plan?.planned_entry_price != null) {
        candles.createPriceLine({
          price: parseFloat(plan.planned_entry_price),
          color: '#2563eb',
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: 'Plan',
        })
      }
      if (plan?.planned_target_price != null) {
        candles.createPriceLine({
          price: parseFloat(plan.planned_target_price),
          color: '#059669',
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: 'Target',
        })
      }
      if (plan?.planned_stop_loss != null) {
        candles.createPriceLine({
          price: parseFloat(plan.planned_stop_loss),
          color: '#dc2626',
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: 'Stop',
        })
      }

      // ── Entry / exit markers ───────────────────────────────────────────
      const isLong = trade.direction === 'LONG'
      const markers = []
      if (entryPrice && data.entryTime) {
        markers.push({
          time: data.entryTime,
          position: isLong ? 'belowBar' : 'aboveBar',
          color: '#10b981',
          shape: isLong ? 'arrowUp' : 'arrowDown',
          text: `${isLong ? 'BUY' : 'SHORT'} ${fmtPrice(entryPrice, trade.currency)}`,
          size: 2,
        })
      }
      if (exitPrice && data.exitTime) {
        markers.push({
          time: data.exitTime,
          position: isLong ? 'aboveBar' : 'belowBar',
          color: '#ef4444',
          shape: isLong ? 'arrowDown' : 'arrowUp',
          text: `${isLong ? 'SELL' : 'COVER'} ${fmtPrice(exitPrice, trade.currency)}`,
          size: 2,
        })
      }
      if (markers.length) createSeriesMarkers(candles, markers)

      // ── Hold-window soft shading on its own overlay scale ──────────────
      // Critical: the area series must NOT share the candle scale, or its
      // implicit zero-baseline drags the y-axis down (turning a $110 chart
      // into a -20→140 scale that crushes the candles into a thin band).
      const holdSeries = chart.addSeries(AreaSeries, {
        priceScaleId: 'hold',
        topColor: 'rgba(37, 99, 235, 0.16)',
        bottomColor: 'rgba(37, 99, 235, 0.02)',
        lineColor: 'rgba(37, 99, 235, 0)',
        lineWidth: 0,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      })
      chart.priceScale('hold').applyOptions({
        scaleMargins: { top: 0, bottom: 0 },
        visible: false,
      })
      holdSeries.setData(
        data.bars.map(bar => ({
          time: bar.time,
          value: bar.time >= data.entryTime && bar.time <= data.exitTime ? 1 : null,
        }))
      )

      // ── Visible window — TV-app-like focus on every timeframe change ──
      // If the trade fits comfortably in ~TARGET_VISIBLE_BARS, show the
      // hold centered with symmetric pad. If it doesn't (e.g. user picked
      // 1m on a 9-day swing), zoom in to the entry: 30 bars before, 70
      // after — exit is off-screen but reachable by scrolling.
      const TARGET_VISIBLE_BARS = 100
      const stepSec = barInterval.seconds
      const holdBars = Math.ceil((data.exitTime - data.entryTime) / stepSec)
      let visibleFrom, visibleTo
      if (holdBars * 1.4 <= TARGET_VISIBLE_BARS) {
        const padBars = Math.floor((TARGET_VISIBLE_BARS - holdBars) / 2)
        visibleFrom = data.entryTime - padBars * stepSec
        visibleTo = data.exitTime + padBars * stepSec
      } else {
        visibleFrom = data.entryTime - 30 * stepSec
        visibleTo = data.entryTime + 70 * stepSec
      }
      // Clamp to the actual data range to avoid the chart going blank past the edge.
      visibleFrom = Math.max(visibleFrom, data.bars[0].time)
      visibleTo = Math.min(visibleTo, data.bars[data.bars.length - 1].time)
      chart.timeScale().setVisibleRange({ from: visibleFrom, to: visibleTo })
    } catch (err) {
      console.error('[trade-chart] render failed:', err)
      setError(err.message || 'Could not render chart.')
      if (chart) chart.remove()
      chartRef.current = null
    }

    return () => {
      if (chartRef.current) {
        chartRef.current.remove()
        chartRef.current = null
      }
    }
  }, [trade, plan, barInterval])

  if (error) {
    return (
      <div className="px-4 py-6 text-center text-xs text-gray-400 border border-dashed border-gray-200 rounded-xl bg-white">
        {error}
      </div>
    )
  }

  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden bg-white">
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-100 bg-gray-50">
        <div className="flex items-center gap-2 text-xs text-gray-700">
          <span className="font-semibold">{fmtSymbol(trade)}</span>
          <span className="text-gray-300">·</span>
          <span className="text-gray-500">{barInterval.label}</span>
          <span className="text-gray-300">·</span>
          <span className="italic text-gray-400 text-[11px]">synthetic data — Alpaca wiring pending</span>
        </div>
        <div className="flex items-center gap-1">
          {TIMEFRAMES.map(tf => (
            <button
              key={tf.label}
              onClick={() => setBarInterval(tf)}
              className={`px-2 py-0.5 text-[11px] rounded font-medium transition-colors ${
                tf.label === barInterval.label
                  ? 'bg-blue-600 text-white'
                  : 'bg-white border border-gray-200 text-gray-600 hover:border-blue-400 hover:text-blue-600'
              }`}
            >
              {tf.label}
            </button>
          ))}
        </div>
      </div>
      <div ref={containerRef} className="w-full" style={{ height: 380 }} />
      <div className="flex items-center gap-4 px-4 py-2 border-t border-gray-100 bg-gray-50 text-[11px] text-gray-500 flex-wrap">
        <span><span className="inline-block w-2 h-2 rounded-full bg-emerald-500 mr-1.5 align-middle" />Entry fill</span>
        <span><span className="inline-block w-2 h-2 rounded-full bg-red-500 mr-1.5 align-middle" />Exit fill</span>
        {plan?.planned_entry_price != null && (
          <span><span className="inline-block w-3 border-t border-dashed border-blue-600 mr-1.5 align-middle" />Plan entry</span>
        )}
        {plan?.planned_target_price != null && (
          <span><span className="inline-block w-3 border-t border-dashed border-emerald-600 mr-1.5 align-middle" />Target</span>
        )}
        {plan?.planned_stop_loss != null && (
          <span><span className="inline-block w-3 border-t border-dashed border-red-600 mr-1.5 align-middle" />Stop</span>
        )}
        <span className="ml-auto text-gray-400">Hold window shaded</span>
      </div>
    </div>
  )
}

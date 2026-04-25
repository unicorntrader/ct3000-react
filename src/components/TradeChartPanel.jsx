import React, { useEffect, useRef, useState } from 'react'
import {
  createChart,
  CandlestickSeries,
  AreaSeries,
  LineStyle,
  createSeriesMarkers,
} from 'lightweight-charts'
import { generateMockOhlc } from '../lib/mockOhlc'
import { fmtSymbol, fmtPrice } from '../lib/formatters'

// Trade-review chart panel rendered inside TradeInlineDetail when the user
// clicks "Show chart". Uses TradingView Lightweight Charts (v5) with
// synthetic OHLC data — when /api/ohlc lands (Alpaca-backed), swap the
// generateMockOhlc call for a real fetch.
//
// Rendered overlays:
//   * Candlestick series for OHLC bars
//   * Entry / exit fill markers (arrows)
//   * Planned entry / target / stop horizontal price lines
//   * Hold-window soft area shading
//   * CT3000 watermark

export default function TradeChartPanel({ trade, plan }) {
  const containerRef = useRef(null)
  const chartRef = useRef(null)
  const [error, setError] = useState(null)
  const [intervalLabel, setIntervalLabel] = useState(null)

  useEffect(() => {
    if (!containerRef.current || !trade) return

    let chart
    try {
      const data = generateMockOhlc(trade)
      if (!data || !data.bars.length) {
        setError('Not enough data to render this trade.')
        return
      }
      setIntervalLabel(data.intervalLabel)

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
          scaleMargins: { top: 0.1, bottom: 0.1 },
        },
        timeScale: {
          borderColor: '#e5e7eb',
          timeVisible: data.intervalLabel !== '1D',
          secondsVisible: false,
        },
        crosshair: { mode: 1 },
      })
      chartRef.current = chart

      const candles = chart.addSeries(CandlestickSeries, {
        upColor: '#10b981',
        downColor: '#ef4444',
        borderUpColor: '#10b981',
        borderDownColor: '#ef4444',
        wickUpColor: '#10b981',
        wickDownColor: '#ef4444',
      })
      candles.setData(data.bars)

      // ── Planned levels — only what's actually on the plan ──────────────
      if (plan?.planned_entry_price != null) {
        candles.createPriceLine({
          price: parseFloat(plan.planned_entry_price),
          color: '#2563eb',
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: `Plan entry ${fmtPrice(plan.planned_entry_price, trade.currency)}`,
        })
      }
      if (plan?.planned_target_price != null) {
        candles.createPriceLine({
          price: parseFloat(plan.planned_target_price),
          color: '#059669',
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: `Target ${fmtPrice(plan.planned_target_price, trade.currency)}`,
        })
      }
      if (plan?.planned_stop_loss != null) {
        candles.createPriceLine({
          price: parseFloat(plan.planned_stop_loss),
          color: '#dc2626',
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: `Stop ${fmtPrice(plan.planned_stop_loss, trade.currency)}`,
        })
      }

      // ── Entry / exit markers ───────────────────────────────────────────
      const isLong = trade.direction === 'LONG'
      const entryPrice = parseFloat(trade.avg_entry_price)
      const exitPrice = trade.avg_exit_price != null ? parseFloat(trade.avg_exit_price) : null
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

      // ── Hold-window soft shading ───────────────────────────────────────
      // Critical: put the area series on its own overlay scale (`priceScaleId
      // = 'hold'`) so its zero-baseline doesn't drag the main candle scale
      // down to include 0. Otherwise a $110 stock chart shows -20→140 on the
      // y-axis and the candles get squished into a 5% band at the top.
      const holdSeries = chart.addSeries(AreaSeries, {
        priceScaleId: 'hold',
        topColor: 'rgba(37, 99, 235, 0.18)',
        bottomColor: 'rgba(37, 99, 235, 0.02)',
        lineColor: 'rgba(37, 99, 235, 0)',
        lineWidth: 0,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      })
      // Hide the overlay scale entirely — we don't want a second axis label
      // for "hold window depth" cluttering the chart.
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

      chart.timeScale().fitContent()
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
  }, [trade, plan])

  if (error) {
    return (
      <div className="px-4 py-6 text-center text-xs text-gray-400 border border-dashed border-gray-200 rounded-xl bg-white">
        {error}
      </div>
    )
  }

  return (
    <div className="relative border border-gray-200 rounded-xl overflow-hidden bg-white">
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-100 bg-gray-50">
        <div className="flex items-center gap-2 text-xs text-gray-600">
          <span className="font-semibold">{fmtSymbol(trade)}</span>
          <span className="text-gray-300">·</span>
          <span>{intervalLabel || '—'}</span>
          <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 text-[10px] font-semibold uppercase tracking-wide">
            preview · synthetic data
          </span>
        </div>
        <div className="flex items-center gap-3 text-[11px] text-gray-500">
          <span><span className="inline-block w-2 h-2 rounded-full bg-emerald-500 mr-1.5 align-middle" />Entry</span>
          <span><span className="inline-block w-2 h-2 rounded-full bg-red-500 mr-1.5 align-middle" />Exit</span>
          {plan?.planned_entry_price != null && (
            <span><span className="inline-block w-3 h-0.5 bg-blue-600 mr-1.5 align-middle" />Plan</span>
          )}
          {plan?.planned_target_price != null && (
            <span><span className="inline-block w-3 h-0.5 bg-emerald-600 mr-1.5 align-middle" />Target</span>
          )}
          {plan?.planned_stop_loss != null && (
            <span><span className="inline-block w-3 h-0.5 bg-red-600 mr-1.5 align-middle" />Stop</span>
          )}
        </div>
      </div>
      <div ref={containerRef} className="w-full" style={{ height: 380 }} />
      <div
        className="absolute pointer-events-none select-none"
        style={{ right: 18, bottom: 18, opacity: 0.32, color: '#1e40af' }}
      >
        <div className="text-base font-bold tracking-[0.12em] leading-none">CT3000</div>
        <div className="text-[9px] tracking-[0.16em] font-medium opacity-80 mt-0.5">
          PLAN YOUR TRADE · TRADE YOUR PLAN
        </div>
      </div>
    </div>
  )
}

import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  createChart,
  CandlestickSeries,
  AreaSeries,
  LineSeries,
  HistogramSeries,
  LineStyle,
  createSeriesMarkers,
  createTextWatermark,
} from 'lightweight-charts'
import { pickAutoInterval, TIMEFRAMES } from '../lib/mockOhlc'
import { fetchOhlcForTrade } from '../lib/fetchOhlc'
import { sma, ema, bollinger, vwap } from '../lib/indicators'
import { fmtSymbol, fmtPrice } from '../lib/formatters'

// Default-on / default-off indicator overlays. The user toggles each via
// the indicator pill row in the toolbar.
const DEFAULT_INDICATORS = {
  volume: true,
  sma20: true,
  sma50: true,
  ema20: false,
  bollinger: false,
  vwap: false,
}

// Trade-review chart panel rendered inside TradeInlineDetail when the user
// clicks "Show chart". Uses TradingView Lightweight Charts (v5).
//
// Data path: fetchOhlcForTrade calls /api/ohlc (Alpaca-backed), with a
// synthetic fallback for symbols Alpaca's free tier doesn't cover (options,
// futures, some non-US tickers). The header label switches between
// 'real bars' and 'synthetic data' so the user always knows which.
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
  const [loading, setLoading] = useState(false)
  const [dataSource, setDataSource] = useState(null)
  const [fallbackReason, setFallbackReason] = useState(null)

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

  // Indicator toggle state. Lives at component level so toggling a pill
  // re-runs the chart effect and re-builds the series cleanly.
  const [indicators, setIndicators] = useState(DEFAULT_INDICATORS)
  const toggleIndicator = (key) =>
    setIndicators((prev) => ({ ...prev, [key]: !prev[key] }))

  // Crosshair-driven OHLCV legend. Updated by subscribeCrosshairMove
  // inside the chart effect; rendered as a small overlay top-left.
  const [legend, setLegend] = useState(null)

  useEffect(() => {
    if (!containerRef.current || !trade) return

    let chart
    let cancelled = false
    const abort = new AbortController()

    setLoading(true)
    setError(null)
    setDataSource(null)

    ;(async () => {
      let data
      try {
        data = await fetchOhlcForTrade(trade, barInterval, { signal: abort.signal })
      } catch (err) {
        if (cancelled || err.name === 'AbortError') return
        console.error('[trade-chart] fetch failed:', err)
        setError(err.message || 'Could not load chart data.')
        setLoading(false)
        return
      }
      if (cancelled) return
      if (!data || !data.bars.length) {
        setError(data?.error || 'Not enough data to render this trade.')
        setLoading(false)
        return
      }
      setDataSource(data.source)
      setFallbackReason(data.fallbackReason || null)
      setLoading(false)

      try {

      // Chart height grows when the volume sub-pane is on.
      const chartHeight = indicators.volume ? 460 : 380
      chart = createChart(containerRef.current, {
        height: chartHeight,
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

      // ── Indicator overlays (in price pane) ─────────────────────────────
      // Each indicator gets its own LineSeries so it can be toggled
      // independently. They're computed client-side from the bar series.
      const indicatorSeries = []
      if (indicators.sma20) {
        const s = chart.addSeries(LineSeries, {
          color: '#f59e0b', lineWidth: 1.5, priceLineVisible: false, lastValueVisible: false, title: 'SMA 20',
        })
        s.setData(sma(data.bars, 20))
        indicatorSeries.push(s)
      }
      if (indicators.sma50) {
        const s = chart.addSeries(LineSeries, {
          color: '#8b5cf6', lineWidth: 1.5, priceLineVisible: false, lastValueVisible: false, title: 'SMA 50',
        })
        s.setData(sma(data.bars, 50))
        indicatorSeries.push(s)
      }
      if (indicators.ema20) {
        const s = chart.addSeries(LineSeries, {
          color: '#0ea5e9', lineWidth: 1.5, lineStyle: LineStyle.Dashed, priceLineVisible: false, lastValueVisible: false, title: 'EMA 20',
        })
        s.setData(ema(data.bars, 20))
        indicatorSeries.push(s)
      }
      if (indicators.bollinger) {
        const bb = bollinger(data.bars, 20, 2)
        const upper = chart.addSeries(LineSeries, {
          color: 'rgba(107, 114, 128, 0.7)', lineWidth: 1, priceLineVisible: false, lastValueVisible: false, title: 'BB upper',
        })
        const middle = chart.addSeries(LineSeries, {
          color: 'rgba(107, 114, 128, 0.5)', lineWidth: 1, lineStyle: LineStyle.Dotted, priceLineVisible: false, lastValueVisible: false, title: 'BB mid',
        })
        const lower = chart.addSeries(LineSeries, {
          color: 'rgba(107, 114, 128, 0.7)', lineWidth: 1, priceLineVisible: false, lastValueVisible: false, title: 'BB lower',
        })
        upper.setData(bb.upper)
        middle.setData(bb.middle)
        lower.setData(bb.lower)
        indicatorSeries.push(upper, middle, lower)
      }
      if (indicators.vwap) {
        const s = chart.addSeries(LineSeries, {
          color: '#fb923c', lineWidth: 1.5, lineStyle: LineStyle.Dashed, priceLineVisible: false, lastValueVisible: false, title: 'VWAP',
        })
        s.setData(vwap(data.bars))
        indicatorSeries.push(s)
      }

      // ── Volume sub-pane ────────────────────────────────────────────────
      // Lives in pane index 1 (below the price pane). Histogram color
      // tracks whether the bar closed up or down vs. its open.
      if (indicators.volume) {
        const volumePane = chart.addPane()
        const volumeSeries = chart.addSeries(
          HistogramSeries,
          { priceFormat: { type: 'volume' }, priceLineVisible: false, lastValueVisible: false },
          1,
        )
        volumeSeries.setData(
          data.bars.map(b => ({
            time: b.time,
            value: b.volume || 0,
            color: b.close >= b.open ? 'rgba(16, 185, 129, 0.6)' : 'rgba(239, 68, 68, 0.6)',
          }))
        )
        // Volume pane gets ~25% of the height; price pane keeps the rest.
        volumePane.setStretchFactor(0.25)
        chart.panes()[0].setStretchFactor(1)
      }

      // ── Crosshair OHLCV legend ─────────────────────────────────────────
      // Updates the floating legend in the chart header as the user moves
      // the cursor across bars. Wired to component state so React handles
      // the rendering rather than us mutating DOM directly.
      chart.subscribeCrosshairMove((param) => {
        if (!param.time || !param.seriesData) {
          setLegend(null)
          return
        }
        const candleData = param.seriesData.get(candles)
        if (!candleData) {
          setLegend(null)
          return
        }
        const bar = data.bars.find(b => b.time === param.time)
        setLegend({
          o: candleData.open,
          h: candleData.high,
          l: candleData.low,
          c: candleData.close,
          v: bar?.volume ?? null,
        })
      })

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
        if (cancelled) return
        console.error('[trade-chart] render failed:', err)
        setError(err.message || 'Could not render chart.')
        if (chart) chart.remove()
        chartRef.current = null
      }
    })()

    return () => {
      cancelled = true
      abort.abort()
      if (chartRef.current) {
        chartRef.current.remove()
        chartRef.current = null
      }
    }
  }, [trade, plan, barInterval, indicators])

  // Screenshot — uses lightweight-charts' built-in takeScreenshot which
  // returns a canvas containing the full visible chart (price pane,
  // sub-panes, watermark, markers, indicators). Convert to PNG and
  // trigger a download with a filename derived from the trade.
  const handleScreenshot = () => {
    const chart = chartRef.current
    if (!chart) return
    const canvas = chart.takeScreenshot()
    const url = canvas.toDataURL('image/png')
    const dateStr = trade.closed_at
      ? new Date(trade.closed_at).toISOString().slice(0, 10)
      : 'chart'
    const link = document.createElement('a')
    link.href = url
    link.download = `${trade.symbol}-${dateStr}-${barInterval.label}.png`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

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
          {loading && (
            <>
              <span className="text-gray-300">·</span>
              <span className="text-gray-400 text-[11px] italic">loading…</span>
            </>
          )}
          {!loading && dataSource === 'synthetic' && (
            <>
              <span className="text-gray-300">·</span>
              <span className="italic text-amber-600 text-[11px]">
                synthetic data{fallbackReason ? ` — ${fallbackReason}` : ''}
              </span>
            </>
          )}
          {!loading && dataSource === 'alpaca' && (
            <>
              <span className="text-gray-300">·</span>
              <span className="text-gray-400 text-[11px]">Alpaca · IEX</span>
            </>
          )}
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
          <button
            onClick={handleScreenshot}
            title="Save chart as PNG"
            className="ml-2 px-2 py-0.5 text-[11px] rounded font-medium bg-white border border-gray-200 text-gray-600 hover:border-blue-400 hover:text-blue-600 transition-colors inline-flex items-center gap-1"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            PNG
          </button>
        </div>
      </div>
      {/* Indicator toggle row */}
      <div className="flex items-center gap-1 px-4 py-1.5 border-b border-gray-100 bg-white text-[11px] flex-wrap">
        <span className="text-gray-400 mr-2">Indicators:</span>
        {[
          { key: 'volume', label: 'Volume' },
          { key: 'sma20', label: 'SMA 20', dot: '#f59e0b' },
          { key: 'sma50', label: 'SMA 50', dot: '#8b5cf6' },
          { key: 'ema20', label: 'EMA 20', dot: '#0ea5e9' },
          { key: 'bollinger', label: 'BB' },
          { key: 'vwap', label: 'VWAP', dot: '#fb923c' },
        ].map(ind => (
          <button
            key={ind.key}
            onClick={() => toggleIndicator(ind.key)}
            className={`px-2 py-0.5 rounded font-medium transition-colors inline-flex items-center gap-1.5 ${
              indicators[ind.key]
                ? 'bg-blue-50 text-blue-700 border border-blue-200'
                : 'bg-white border border-gray-200 text-gray-500 hover:border-gray-300'
            }`}
          >
            {ind.dot && <span className="inline-block w-2 h-2 rounded-full" style={{ background: ind.dot }} />}
            {ind.label}
          </button>
        ))}
      </div>
      <div className="relative">
        <div ref={containerRef} className="w-full" style={{ height: indicators.volume ? 460 : 380 }} />
        {legend && (
          <div className="absolute top-2 left-3 z-10 bg-white/85 backdrop-blur px-2.5 py-1 rounded text-[11px] font-mono text-gray-700 border border-gray-100 shadow-sm pointer-events-none">
            <span className="text-gray-400 mr-1">O</span>{legend.o?.toFixed(2)}
            <span className="text-gray-400 mx-1">H</span>{legend.h?.toFixed(2)}
            <span className="text-gray-400 mx-1">L</span>{legend.l?.toFixed(2)}
            <span className="text-gray-400 mx-1">C</span>
            <span className={legend.c >= legend.o ? 'text-emerald-600' : 'text-red-500'}>
              {legend.c?.toFixed(2)}
            </span>
            {legend.v != null && (
              <>
                <span className="text-gray-400 mx-1">V</span>
                {legend.v.toLocaleString()}
              </>
            )}
          </div>
        )}
      </div>
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

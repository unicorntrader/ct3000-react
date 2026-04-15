import React, { useState, useEffect } from 'react'
import { supabase } from '../lib/supabaseClient'
import { fmtPrice, fmtPnl, fmtDateLong } from '../lib/formatters'
import { computeAdherenceScore } from '../lib/adherenceScore'

// Rendered inline underneath a trade row in the Smart Journal table. Same
// content the old TradeJournalDrawer used to show, but with no overlay, no
// slide animation, and no close button — collapsing is handled by the parent
// toggling expandedTradeId.
//
// A single trade is shown in its native currency, not base — consistent with
// the row-level rendering above. See docs/WORKFLOW.md § base currency for why.

function StatCard({ label, value, color }) {
  return (
    <div className="bg-white rounded-xl p-3 text-center border border-gray-200">
      <p className="text-xs text-gray-400 mb-1">{label}</p>
      <p className={`text-sm font-semibold ${color || 'text-gray-900'}`}>{value}</p>
    </div>
  )
}

function AdherencePill({ score }) {
  if (score == null) return null
  const { bg, text } = score >= 75
    ? { bg: 'bg-green-100', text: 'text-green-700' }
    : score >= 50
    ? { bg: 'bg-amber-100', text: 'text-amber-700' }
    : { bg: 'bg-red-100', text: 'text-red-700' }
  return (
    <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold ${bg} ${text}`}>
      {score}
    </span>
  )
}

export default function TradeInlineDetail({ trade, plan, onSaved }) {
  const [notes, setNotes] = useState(trade?.review_notes || '')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  // Reset when the trade changes (parent re-expands a different row)
  useEffect(() => {
    setNotes(trade?.review_notes || '')
    setSaved(false)
  }, [trade])

  if (!trade) return null

  const isOpen_trade = trade.status === 'open'
  // Single-trade view → native currency, not base
  const pnl = isOpen_trade ? null : (trade.total_realized_pnl || 0)
  const isWin = (pnl || 0) > 0
  const isMatchedClosed = trade.status === 'closed' && trade.matching_status === 'matched'
  const currency = trade.currency || 'USD'

  // Derive actual exit price (approx — does not account for commissions)
  const closingQty = trade.total_closing_quantity || trade.total_opening_quantity || 0
  let actualExit = null
  if (trade.avg_entry_price != null && closingQty > 0 && trade.total_realized_pnl != null) {
    actualExit = trade.direction === 'LONG'
      ? trade.avg_entry_price + (trade.total_realized_pnl / closingQty)
      : trade.avg_entry_price - (trade.total_realized_pnl / closingQty)
  }

  // R-multiple — native P&L / native risk (unitless ratio)
  let rMultiple = null
  if (plan && plan.planned_entry_price != null && plan.planned_stop_loss != null && closingQty > 0 && pnl != null) {
    const risk = Math.abs(plan.planned_entry_price - plan.planned_stop_loss) * closingQty
    if (risk > 0) rMultiple = (pnl / risk).toFixed(1) + 'R'
  }

  const adherence = isMatchedClosed ? computeAdherenceScore(plan, trade) : null
  const dateDisplay = fmtDateLong(isOpen_trade ? trade.opened_at : trade.closed_at)

  // Plan vs actual rows — only fields present on the plan
  const planRows = []
  if (plan) {
    if (plan.planned_entry_price != null)
      planRows.push({ label: 'Entry', planned: fmtPrice(plan.planned_entry_price, currency), actual: fmtPrice(trade.avg_entry_price, currency) })
    if (plan.planned_target_price != null)
      planRows.push({ label: 'Target', planned: fmtPrice(plan.planned_target_price, currency), actual: actualExit != null ? fmtPrice(actualExit, currency) : '—' })
    if (plan.planned_stop_loss != null)
      planRows.push({ label: 'Stop', planned: fmtPrice(plan.planned_stop_loss, currency), actual: actualExit != null ? fmtPrice(actualExit, currency) : '—' })
    if (plan.planned_quantity != null)
      planRows.push({ label: 'Quantity', planned: String(plan.planned_quantity), actual: String(trade.total_opening_quantity ?? '—') })
  }

  const handleSave = async () => {
    setSaving(true)
    const score = isMatchedClosed ? computeAdherenceScore(plan, trade) : null
    const { data: updated, error } = await supabase
      .from('logical_trades')
      .update({ review_notes: notes.trim() || null, adherence_score: score })
      .eq('id', trade.id)
      .eq('user_id', trade.user_id)
      .select()
      .single()
    setSaving(false)
    if (error) {
      console.error('[inline-detail] save failed:', error.message)
      alert(`Could not save notes: ${error.message}`)
      return
    }
    setSaved(true)
    if (updated && onSaved) onSaved(updated)
    setTimeout(() => setSaved(false), 1500)
  }

  return (
    <div className="px-6 py-5 bg-gray-50 border-y border-gray-100">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 max-w-5xl">
        {/* Left column: stats + plan vs actual */}
        <div>
          {/* Header row */}
          <div className="flex items-center flex-wrap gap-2 mb-4">
            <span className="text-base font-semibold text-gray-900">{trade.symbol}</span>
            <span className={`px-2 py-0.5 text-xs rounded-full font-medium ${
              trade.direction === 'LONG' ? 'bg-blue-50 text-blue-600' : 'bg-red-50 text-red-600'
            }`}>
              {trade.direction}
            </span>
            {isOpen_trade ? (
              <span className="px-2 py-0.5 text-xs rounded-full font-medium bg-blue-50 text-blue-600">open</span>
            ) : (
              <span className={`px-2 py-0.5 text-xs rounded-full font-medium ${
                isWin ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-700'
              }`}>
                {isWin ? 'win' : 'loss'}
              </span>
            )}
            <span className="text-xs text-gray-400 ml-1">{dateDisplay}</span>
          </div>

          {/* Stats row */}
          <div className="grid grid-cols-4 gap-2 mb-5">
            <StatCard label="Entry" value={fmtPrice(trade.avg_entry_price, currency)} />
            <StatCard label="Exit" value={actualExit != null ? fmtPrice(actualExit, currency) : '—'} />
            <StatCard
              label="P&L"
              value={pnl != null ? fmtPnl(pnl, currency) : '—'}
              color={pnl == null ? 'text-gray-400' : isWin ? 'text-green-600' : 'text-red-500'}
            />
            <StatCard
              label="R"
              value={rMultiple ?? '—'}
              color={rMultiple ? (parseFloat(rMultiple) >= 0 ? 'text-green-600' : 'text-red-500') : 'text-gray-400'}
            />
          </div>

          {/* Plan vs actual — matched closed trades only */}
          {isMatchedClosed && planRows.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Plan vs actual</p>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-400">Adherence</span>
                  <AdherencePill score={adherence} />
                </div>
              </div>
              <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
                {planRows.map(row => (
                  <div key={row.label} className="flex items-center justify-between px-4 py-2">
                    <span className="text-xs text-gray-400 w-16">{row.label}</span>
                    <span className="text-xs text-gray-300 line-through">{row.planned}</span>
                    <span className="text-xs font-medium text-blue-600">{row.actual}</span>
                  </div>
                ))}
              </div>
              {plan.thesis && (
                <p className="mt-2 text-xs text-gray-400 italic border-l-2 border-gray-200 pl-3">
                  "{plan.thesis}"
                </p>
              )}
            </div>
          )}
        </div>

        {/* Right column: notes */}
        <div>
          <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
            Notes
          </label>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="What happened? What would you do differently?"
            rows={6}
            className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white text-gray-900 placeholder-gray-300 resize-none"
            onClick={e => e.stopPropagation()}
          />
          <button
            onClick={e => { e.stopPropagation(); handleSave(); }}
            disabled={saving || saved}
            className="mt-3 w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 rounded-xl text-sm transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
          >
            {saved ? (
              <>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                </svg>
                Saved
              </>
            ) : saving ? 'Saving…' : 'Save notes'}
          </button>
        </div>
      </div>
    </div>
  )
}

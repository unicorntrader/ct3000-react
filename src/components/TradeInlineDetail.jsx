import React, { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabaseClient'
import { fmtPrice, fmtPnl, fmtDateLong, fmtSymbol } from '../lib/formatters'
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

export default function TradeInlineDetail({ trade, plan, onSaved, onCollapse }) {
  const [notes, setNotes] = useState(trade?.review_notes || '')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  // Refs so the keyboard effect can call the latest handler without having it
  // in its deps (and without needing to live below the early return).
  const handleSaveRef = useRef(null)
  const onCollapseRef = useRef(onCollapse)
  onCollapseRef.current = onCollapse

  // Reset when the trade changes (parent re-expands a different row)
  useEffect(() => {
    setNotes(trade?.review_notes || '')
    setSaved(false)
  }, [trade])

  // Keyboard: Esc collapses the row, Cmd/Ctrl+Enter saves the note.
  // Declared at the top of the component so the hook count stays stable
  // regardless of the !trade early return below.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onCollapseRef.current?.()
        return
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault()
        handleSaveRef.current?.()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const isDirty = notes.trim() !== (trade?.review_notes || '').trim()

  if (!trade) return null

  const isOpen_trade = trade.status === 'open'
  // Single-trade view → native currency, not base
  const pnl = isOpen_trade ? null : (trade.total_realized_pnl || 0)
  const isWin = (pnl || 0) > 0
  const isMatchedClosed = trade.status === 'closed' && trade.matching_status === 'matched'
  // A trade is "resolved" once the user or auto-matcher has committed to
  // either a plan link or an explicit "no plan" decision. Resolved trades
  // can be reset to unmatched so they re-enter the review queue.
  const isResolved = trade.status === 'closed' && (
    trade.matching_status === 'matched' || trade.matching_status === 'manual'
  )
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
    if (saving || !isDirty) return
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
    // Keep the "Saved" confirmation visible longer so the user actually sees it
    setTimeout(() => setSaved(false), 3000)
  }

  // Reset the match so the trade re-enters the /review queue. Used when the
  // user realises they matched to the wrong plan, or said "No plan" too
  // quickly and actually had one. Preserves review_notes + adherence_score
  // (they'll recompute on next re-match if the plan changes).
  const handleResetMatch = async () => {
    const ok = window.confirm(
      'Reset the match for this trade? It will reappear in Needs review so you can re-link it.'
    )
    if (!ok) return
    const { data: updated, error } = await supabase
      .from('logical_trades')
      .update({
        matching_status: 'unmatched',
        planned_trade_id: null,
        adherence_score: null,
      })
      .eq('id', trade.id)
      .eq('user_id', trade.user_id)
      .select()
      .single()
    if (error) {
      console.error('[inline-detail] reset match failed:', error.message)
      alert(`Could not reset match: ${error.message}`)
      return
    }
    if (updated && onSaved) onSaved(updated)
  }

  // Keep the ref pointed at the latest handleSave so the top-level keyboard
  // effect always calls the up-to-date version without listing it as a dep.
  handleSaveRef.current = handleSave

  return (
    <div className="px-6 py-5 bg-gray-50 border-y border-gray-100">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 max-w-5xl">
        {/* Left column: stats + plan vs actual */}
        <div>
          {/* Header row */}
          <div className="flex items-center flex-wrap gap-2 mb-4">
            <span className="text-base font-semibold text-gray-900">{fmtSymbol(trade)}</span>
            {trade.asset_category && trade.asset_category !== 'STK' && (
              <span className="px-1.5 py-0.5 text-[10px] font-semibold rounded bg-gray-100 text-gray-500">
                {trade.asset_category}
              </span>
            )}
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
            {isResolved && (
              <button
                onClick={e => { e.stopPropagation(); handleResetMatch(); }}
                className="ml-auto text-xs text-gray-400 hover:text-blue-600 underline decoration-dotted underline-offset-2"
                title="Clear the plan match and send this trade back to Needs review"
              >
                Reset match
              </button>
            )}
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
                <div className="mt-3">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Thesis</p>
                  <p className="text-xs text-gray-500 italic border-l-2 border-gray-200 pl-3">
                    "{plan.thesis}"
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right column: notes */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide">
              Notes
            </label>
            {isDirty && !saved && (
              <span className="text-xs text-amber-600 font-medium">Unsaved changes</span>
            )}
          </div>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="What happened? What would you do differently?"
            rows={6}
            className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white text-gray-900 placeholder-gray-300 resize-none"
            onClick={e => e.stopPropagation()}
          />

          {/* Save button — bigger state differences so "saved" is obvious */}
          <button
            onClick={e => { e.stopPropagation(); handleSave(); }}
            disabled={saving || !isDirty}
            className={`mt-3 w-full font-semibold py-3 rounded-xl text-sm transition-all flex items-center justify-center gap-2 ${
              saved
                ? 'bg-green-500 text-white ring-2 ring-green-300 scale-[1.01]'
                : isDirty
                ? 'bg-blue-600 hover:bg-blue-700 text-white'
                : 'bg-gray-100 text-gray-400 cursor-not-allowed'
            }`}
          >
            {saved ? (
              <>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                </svg>
                Saved
              </>
            ) : saving ? 'Saving…' : isDirty ? 'Save notes' : 'No changes'}
          </button>

          {/* Keyboard shortcut hints */}
          <p className="mt-2 text-[11px] text-gray-400 text-center">
            <kbd className="px-1.5 py-0.5 bg-white border border-gray-200 rounded text-gray-500">⌘ ↵</kbd> save &middot;
            <kbd className="ml-2 px-1.5 py-0.5 bg-white border border-gray-200 rounded text-gray-500">Esc</kbd> close
          </p>
        </div>
      </div>
    </div>
  )
}

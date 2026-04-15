import React, { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabaseClient'
import { fmtPrice, fmtPnl, fmtDateLong, pnlBase } from '../lib/formatters'
import { computeAdherenceScore } from '../lib/adherenceScore'

function StatCard({ label, value, color }) {
  return (
    <div className="bg-gray-50 rounded-xl p-3 text-center border border-gray-100">
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

export default function TradeJournalDrawer({ trade, plan, baseCurrency, isOpen, onClose, onSaved }) {
  const [notes, setNotes]   = useState('')
  const [saving, setSaving] = useState(false)
  const [saved,  setSaved]  = useState(false)

  useEffect(() => {
    setNotes(trade?.review_notes || '')
    setSaved(false)
  }, [trade])

  const handleSaveRef = useRef(null)
  const onCloseRef    = useRef(onClose)
  onCloseRef.current  = onClose   // always points to the latest prop, no stale closure

  useEffect(() => {
    if (!isOpen) return
    const handler = (e) => {
      if (e.key === 'Escape') { onCloseRef.current(); return }
      if (e.key === 'Enter' && !e.shiftKey && !['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) {
        e.preventDefault()
        handleSaveRef.current?.()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [isOpen])   // isOpen only — onClose is stable via ref

  if (!trade) return (
    <>
      <div className={`overlay-bg ${isOpen ? 'open' : ''}`} onClick={onClose} />
      <div className={`slide-up ${isOpen ? 'open' : ''}`} />
    </>
  )

  const isOpen_trade  = trade.status === 'open'
  const pnl           = isOpen_trade ? null : pnlBase(trade)
  const isWin         = (pnl || 0) > 0
  const isMatchedClosed = trade.status === 'closed' && trade.matching_status === 'matched'
  const currency      = baseCurrency || 'USD'

  // Derive actual exit price (approx — does not account for commissions)
  const closingQty = trade.total_closing_quantity || trade.total_opening_quantity || 0
  let actualExit = null
  if (trade.avg_entry_price != null && closingQty > 0 && trade.total_realized_pnl != null) {
    actualExit = trade.direction === 'LONG'
      ? trade.avg_entry_price + (trade.total_realized_pnl / closingQty)
      : trade.avg_entry_price - (trade.total_realized_pnl / closingQty)
  }

  // R-multiple
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
      console.error('[drawer] save failed:', error.message)
      alert(`Could not save notes: ${error.message}`)
      return
    }
    setSaved(true)
    if (updated && onSaved) onSaved(updated)
    setTimeout(() => { setSaved(false); onClose() }, 1000)
  }
  // Keep ref up-to-date so the keyboard effect always calls the latest version
  handleSaveRef.current = handleSave

  return (
    <>
      <div className={`overlay-bg ${isOpen ? 'open' : ''}`} onClick={onClose} />
      <div className={`slide-up ${isOpen ? 'open' : ''}`}>
        <div className="px-5 pt-3 pb-8">
          {/* Handle bar */}
          <div className="w-10 h-1 bg-gray-200 rounded-full mx-auto mb-4" />

          {/* Header */}
          <div className="flex items-start justify-between mb-5">
            <div className="flex items-center flex-wrap gap-2">
              <span className="text-lg font-semibold text-gray-900">{trade.symbol}</span>
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
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs text-gray-400">{dateDisplay}</span>
              <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          {/* Stats row */}
          <div className="grid grid-cols-4 gap-2 mb-6">
            <StatCard label="Entry"  value={fmtPrice(trade.avg_entry_price, currency)} />
            <StatCard label="Exit"   value={actualExit != null ? fmtPrice(actualExit, currency) : '—'} />
            <StatCard
              label="P&L"
              value={pnl != null ? fmtPnl(pnl, currency) : '—'}
              color={pnl == null ? 'text-gray-400' : isWin ? 'text-green-600' : 'text-red-500'}
            />
            <StatCard label="R" value={rMultiple ?? '—'} color={rMultiple ? (parseFloat(rMultiple) >= 0 ? 'text-green-600' : 'text-red-500') : 'text-gray-400'} />
          </div>

          {/* Plan vs actual — matched trades only */}
          {isMatchedClosed && planRows.length > 0 && (
            <div className="mb-6">
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Plan vs actual</p>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-400">Adherence</span>
                  <AdherencePill score={adherence} />
                </div>
              </div>
              <div className="bg-gray-50 rounded-xl border border-gray-100 divide-y divide-gray-100">
                {planRows.map(row => (
                  <div key={row.label} className="flex items-center justify-between px-4 py-2.5">
                    <span className="text-xs text-gray-400 w-16">{row.label}</span>
                    <span className="text-xs text-gray-300 line-through">{row.planned}</span>
                    <span className="text-xs font-medium text-blue-600">{row.actual}</span>
                  </div>
                ))}
              </div>
              {(plan.notes || plan.thesis) && (
                <p className="mt-3 text-xs text-gray-400 italic border-l-2 border-gray-200 pl-3">
                  "{plan.notes || plan.thesis}"
                </p>
              )}
            </div>
          )}

          {/* Notes */}
          <div className="mb-4">
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
              Notes
            </label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="What happened? What would you do differently?"
              rows={4}
              className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-gray-50 text-gray-900 placeholder-gray-300 resize-none"
            />
          </div>

          {/* Save */}
          <button
            onClick={handleSave}
            disabled={saving || saved}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3.5 rounded-xl text-sm transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
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
    </>
  )
}

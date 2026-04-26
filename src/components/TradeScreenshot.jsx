import React, { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { compressImage } from '../lib/imageCompress'
import { useBumpDataVersion } from '../lib/DataVersionContext'

// Trade-screenshot upload + preview + delete.
// One screenshot per trade. Stored at:
//   trade-screenshots / {user_id} / {opening_ib_order_id}_{conid_or_0}.jpg
//
// The path is naturally tied to the trade's stable identity
// (opening_ib_order_id + conid), so:
//   * re-uploading overwrites the same Storage object, no orphan files
//   * the path string survives rebuildForUser via the existing
//     preservation mechanism (see api/_lib/rebuildForUser.js — same
//     pattern used for review_notes, user_reviewed, etc.)
//
// Exposed as a hook + two stateless render pieces so the parent
// (TradeInlineDetail) can place the action buttons and the thumbnail
// in two different sections without losing shared state.

function buildPath(trade) {
  if (!trade?.user_id || !trade?.opening_ib_order_id) return null
  const conidPart = trade.conid != null ? trade.conid : '0'
  return `${trade.user_id}/${trade.opening_ib_order_id}_${conidPart}.jpg`
}

export function useTradeScreenshot(trade, onSaved) {
  const fileInputRef = useRef(null)
  const [signedUrl, setSignedUrl] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [lightboxOpen, setLightboxOpen] = useState(false)
  const bump = useBumpDataVersion()

  const path = trade?.screenshot_path || null

  useEffect(() => {
    let cancelled = false
    if (!path) {
      setSignedUrl(null)
      return
    }
    ;(async () => {
      const { data, error: signErr } = await supabase
        .storage
        .from('trade-screenshots')
        .createSignedUrl(path, 60 * 60) // 1h, refreshed on each detail open
      if (cancelled) return
      if (signErr) {
        console.error('[trade-screenshot] sign url failed:', signErr.message)
        setError('Could not load screenshot.')
        return
      }
      setSignedUrl(data?.signedUrl || null)
    })()
    return () => { cancelled = true }
  }, [path])

  const pickFile = () => fileInputRef.current?.click()

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-picking the same file
    if (!file) return
    if (!buildPath(trade)) {
      setError('This trade has no opening_ib_order_id — screenshots can only be attached to imported trades.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const blob = await compressImage(file)
      const targetPath = buildPath(trade)
      // upsert: true so re-upload overwrites the same Storage object
      const { error: upErr } = await supabase
        .storage
        .from('trade-screenshots')
        .upload(targetPath, blob, {
          contentType: 'image/jpeg',
          upsert: true,
        })
      if (upErr) throw upErr

      const { data: updated, error: dbErr } = await supabase
        .from('logical_trades')
        .update({ screenshot_path: targetPath })
        .eq('id', trade.id)
        .eq('user_id', trade.user_id)
        .select()
        .single()
      if (dbErr) throw dbErr

      bump('trades')
      if (updated && onSaved) onSaved(updated)
    } catch (err) {
      console.error('[trade-screenshot] upload failed:', err?.message || err)
      setError(err?.message || 'Upload failed.')
    } finally {
      setBusy(false)
    }
  }

  const removeFile = async () => {
    if (!path) return
    if (!window.confirm('Remove this screenshot?')) return
    setBusy(true)
    setError(null)
    try {
      const { error: delErr } = await supabase
        .storage
        .from('trade-screenshots')
        .remove([path])
      if (delErr) console.warn('[trade-screenshot] storage remove warn:', delErr.message)

      const { data: updated, error: dbErr } = await supabase
        .from('logical_trades')
        .update({ screenshot_path: null })
        .eq('id', trade.id)
        .eq('user_id', trade.user_id)
        .select()
        .single()
      if (dbErr) throw dbErr

      bump('trades')
      if (updated && onSaved) onSaved(updated)
    } catch (err) {
      console.error('[trade-screenshot] delete failed:', err?.message || err)
      setError(err?.message || 'Delete failed.')
    } finally {
      setBusy(false)
    }
  }

  return {
    path, signedUrl, busy, error, lightboxOpen, setLightboxOpen,
    fileInputRef, handleFileChange, pickFile, removeFile,
  }
}

const BTN_BASE = 'inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white border border-gray-200 text-sm font-medium text-gray-600 transition-colors disabled:opacity-50'

export function ScreenshotActions({ state }) {
  const { path, busy, error, fileInputRef, handleFileChange, pickFile, removeFile } = state
  return (
    <>
      {!path ? (
        <button
          onClick={pickFile}
          disabled={busy}
          className={`${BTN_BASE} hover:border-blue-400 hover:text-blue-600`}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
          {busy ? 'Uploading…' : 'Add screenshot'}
        </button>
      ) : (
        <>
          <button
            onClick={pickFile}
            disabled={busy}
            className={`${BTN_BASE} hover:border-blue-400 hover:text-blue-600`}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            {busy ? 'Uploading…' : 'Replace screenshot'}
          </button>
          <button
            onClick={removeFile}
            disabled={busy}
            className={`${BTN_BASE} hover:border-red-400 hover:text-red-600`}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3M4 7h16" />
            </svg>
            Remove screenshot
          </button>
        </>
      )}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg"
        onChange={handleFileChange}
        className="hidden"
      />
      {error && <span className="text-xs text-red-500 ml-2">{error}</span>}
    </>
  )
}

export function ScreenshotThumbnail({ state }) {
  const { path, signedUrl, lightboxOpen, setLightboxOpen } = state
  if (!path) return null
  return (
    <>
      <button
        type="button"
        onClick={() => setLightboxOpen(true)}
        className="block w-48 h-32 rounded-lg overflow-hidden border border-gray-200 hover:border-blue-400 transition-colors bg-gray-50"
      >
        {signedUrl ? (
          <img src={signedUrl} alt="Trade screenshot" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-xs text-gray-300">loading…</div>
        )}
      </button>

      {lightboxOpen && signedUrl && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-6 cursor-zoom-out"
          onClick={() => setLightboxOpen(false)}
        >
          <img
            src={signedUrl}
            alt="Trade screenshot full size"
            className="max-w-full max-h-full rounded-lg shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
          <button
            onClick={() => setLightboxOpen(false)}
            className="absolute top-4 right-4 text-white/80 hover:text-white"
            aria-label="Close"
          >
            <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}
    </>
  )
}

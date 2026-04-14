import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'

export default function WelcomeModal({ userId, onDone }) {
  const navigate = useNavigate()
  const [skipping, setSkipping] = useState(false)
  const [error, setError] = useState(null)

  const dismiss = async (destination) => {
    setSkipping(true)
    setError(null)
    const { error: updateErr } = await supabase
      .from('user_subscriptions')
      .update({ has_seen_welcome: true })
      .eq('user_id', userId)
    if (updateErr) {
      setError('Something went wrong. Please try again.')
      setSkipping(false)
      return
    }
    onDone()
    if (destination) navigate(destination)
  }

  return (
    <div className="fixed inset-0 z-50 bg-white flex items-center justify-center px-6">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="flex items-center gap-2.5 mb-10">
          <div className="w-9 h-9 bg-blue-600 rounded-xl flex items-center justify-center">
            <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
            </svg>
          </div>
          <span className="text-xl font-bold text-gray-900">CT3000</span>
        </div>

        <h1 className="text-2xl font-bold text-gray-900 mb-2">Welcome to CT3000</h1>
        <p className="text-sm text-gray-400 mb-8 leading-relaxed">
          Connect your IBKR account to import your trades and start journalling.
        </p>

        <div className="space-y-3">
          <button
            onClick={() => dismiss('/ibkr')}
            disabled={skipping}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3.5 rounded-xl text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {skipping ? 'One moment…' : 'Connect IBKR account'}
          </button>

          <button
            onClick={() => dismiss(null)}
            disabled={skipping}
            className="w-full bg-gray-50 hover:bg-gray-100 text-gray-500 font-medium py-3.5 rounded-xl text-sm border border-gray-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Skip for now
          </button>
        </div>

        {error && (
          <div className="mt-4 bg-red-50 border border-red-100 rounded-xl px-4 py-3 text-sm text-red-600">
            {error}
          </div>
        )}
      </div>
    </div>
  )
}

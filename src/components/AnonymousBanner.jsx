import React, { useState } from 'react'
import { supabase } from '../lib/supabaseClient'

async function createCheckoutSession(accessToken) {
  const res = await fetch('/api/create-checkout-session', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${accessToken}`,
    },
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Failed to start checkout')
  return data.url
}

export default function AnonymousBanner() {
  const [expanded, setExpanded] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const handleConvert = async (e) => {
    e.preventDefault()
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return }
    if (!/[0-9]/.test(password)) { setError('Password must contain at least one number.'); return }
    if (!/[A-Z]/.test(password) && !/[!@#$%^&*]/.test(password)) {
      setError('Password must contain at least one uppercase letter or special character (!@#$%^&*).')
      return
    }
    setLoading(true)
    setError(null)
    try {
      const { error: updateErr } = await supabase.auth.updateUser({ email, password })
      if (updateErr) throw updateErr
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) throw new Error('Session not found — please disable email confirmation in Supabase Auth settings.')
      const url = await createCheckoutSession(session.access_token)
      window.location.href = url
      // Don't setLoading(false) — navigating away
    } catch (err) {
      setError(err.message)
      setLoading(false)
    }
  }

  return (
    <div className="bg-blue-600 px-4 py-3">
      {!expanded ? (
        <div className="flex items-center justify-between gap-4 max-w-7xl mx-auto">
          <div>
            <p className="text-sm text-white font-medium">
              You're exploring CT3000 in demo mode.{' '}
              <span className="text-blue-200 font-normal">
                Sign up free to connect your IBKR account and track real trades.
              </span>
            </p>
            <p className="text-xs text-blue-300 mt-0.5">Your demo session expires in 48 hours.</p>
          </div>
          <button
            onClick={() => setExpanded(true)}
            className="flex-shrink-0 bg-white text-blue-700 font-semibold text-xs px-4 py-2 rounded-lg hover:bg-blue-50 transition-colors whitespace-nowrap"
          >
            Sign up free →
          </button>
        </div>
      ) : (
        <div className="max-w-7xl mx-auto">
          <p className="text-sm text-white font-medium mb-3">
            Create your account to save your data and connect IBKR.
          </p>
          <form onSubmit={handleConvert} className="flex flex-wrap items-start gap-2">
            <input
              type="email"
              required
              placeholder="Email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              className="flex-1 min-w-[160px] px-3 py-2 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-white/50 text-gray-900 placeholder-gray-400"
            />
            <input
              type="password"
              required
              placeholder="Password — min 8 chars, 1 number, 1 uppercase"
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="flex-1 min-w-[240px] px-3 py-2 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-white/50 text-gray-900 placeholder-gray-400"
            />
            <button
              type="submit"
              disabled={loading}
              className="bg-white text-blue-700 font-semibold text-sm px-4 py-2 rounded-lg hover:bg-blue-50 transition-colors disabled:opacity-60"
            >
              {loading ? 'Please wait…' : 'Continue to checkout →'}
            </button>
            <button
              type="button"
              onClick={() => { setExpanded(false); setError(null) }}
              className="text-blue-300 text-sm hover:text-white transition-colors px-2 py-2"
            >
              Cancel
            </button>
          </form>
          {error && <p className="text-xs text-red-200 mt-2">{error}</p>}
        </div>
      )}
    </div>
  )
}

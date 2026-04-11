import React, { useState } from 'react'
import { supabase } from '../lib/supabaseClient'

const Logo = () => (
  <div className="text-center mb-8">
    <div className="inline-flex items-center space-x-2 mb-2">
      <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
        <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
        </svg>
      </div>
      <span className="text-xl font-semibold text-gray-900">CT3000</span>
    </div>
    <p className="text-sm text-gray-400">Your IBKR trading co-pilot</p>
  </div>
)

async function callCheckoutSession(accessToken) {
  const res = await fetch('/api/create-checkout-session', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${accessToken}`,
    },
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Failed to create checkout session')
  return data.url
}

export default function AuthScreen() {
  // 'landing' | 'login' | 'signup' | 'reset'
  const [mode, setMode] = useState('landing')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [message, setMessage] = useState(null)

  const clearFeedback = () => { setError(null); setMessage(null) }
  const goTo = (m) => { setMode(m); clearFeedback() }

  const handleLogin = async (e) => {
    e.preventDefault()
    clearFeedback()
    setLoading(true)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) setError(error.message)
    setLoading(false)
  }

  const handleSignup = async (e) => {
    e.preventDefault()
    clearFeedback()
    if (password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    setLoading(true)
    try {
      const { data, error: signUpError } = await supabase.auth.signUp({ email, password })
      if (signUpError) {
        setError(signUpError.message)
        setLoading(false)
        return
      }

      // If email confirmation is required, session will be null
      if (!data.session) {
        setMessage('Account created. Check your email to confirm, then log in.')
        setMode('login')
        setLoading(false)
        return
      }

      // Session available immediately — go straight to Stripe Checkout
      const url = await callCheckoutSession(data.session.access_token)
      window.location.href = url
      // No setLoading(false) — page is navigating away
    } catch (err) {
      setError(err.message)
      setLoading(false)
    }
  }

  const handleReset = async (e) => {
    e.preventDefault()
    clearFeedback()
    setLoading(true)
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    })
    if (error) {
      setError(error.message)
    } else {
      setMessage('Password reset email sent. Check your inbox.')
    }
    setLoading(false)
  }

  // ── Landing ──────────────────────────────────────────────────────────────────
  if (mode === 'landing') {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center px-4">
        <div className="w-full max-w-sm">
          <Logo />
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8">
            <h2 className="text-lg font-semibold text-gray-900 mb-1">Trade smarter.</h2>
            <p className="text-sm text-gray-500 mb-8">
              Sync trades from IBKR, plan entries, track P&amp;L — all in one place.
              7-day free trial, then $30/month.
            </p>
            <div className="space-y-3">
              <button
                onClick={() => goTo('signup')}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 rounded-xl text-sm transition-colors"
              >
                Start free trial
              </button>
              <button
                onClick={() => goTo('login')}
                className="w-full bg-white hover:bg-gray-50 text-gray-700 font-semibold py-3 rounded-xl text-sm border border-gray-200 transition-colors"
              >
                Log in
              </button>
            </div>
          </div>
          <p className="text-center text-xs text-gray-300 mt-6">Plan your trade. Trade your plan.</p>
        </div>
      </div>
    )
  }

  // ── Login / Signup / Reset ───────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <Logo />

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">

          {/* Back button for reset */}
          {mode === 'reset' ? (
            <div className="px-6 pt-6">
              <button
                onClick={() => goTo('login')}
                className="flex items-center space-x-1 text-sm text-gray-400 hover:text-gray-600 mb-4"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
                <span>Back to login</span>
              </button>
              <h3 className="text-base font-semibold text-gray-900 mb-1">Reset password</h3>
              <p className="text-sm text-gray-400 mb-0">We'll send a reset link to your email.</p>
            </div>
          ) : (
            /* Header label */
            <div className="px-6 pt-6 pb-0">
              <h3 className="text-base font-semibold text-gray-900">
                {mode === 'login' ? 'Welcome back' : 'Create your account'}
              </h3>
              {mode === 'signup' && (
                <p className="text-sm text-gray-400 mt-0.5">7-day free trial, then $30/month.</p>
              )}
            </div>
          )}

          <div className="px-6 py-6">
            <form
              onSubmit={mode === 'login' ? handleLogin : mode === 'signup' ? handleSignup : handleReset}
              className="space-y-4"
            >
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
                  Email
                </label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-gray-50 text-gray-900 placeholder-gray-300"
                />
              </div>

              {mode !== 'reset' && (
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
                    Password
                  </label>
                  <input
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={mode === 'signup' ? 'Min 8 characters' : '••••••••'}
                    className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-gray-50 text-gray-900 placeholder-gray-300"
                  />
                </div>
              )}

              {error && (
                <div className="bg-red-50 border border-red-100 rounded-xl px-4 py-3 text-sm text-red-600">
                  {error}
                </div>
              )}
              {message && (
                <div className="bg-green-50 border border-green-100 rounded-xl px-4 py-3 text-sm text-green-700">
                  {message}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-blue-600 text-white font-semibold py-3 rounded-xl text-sm hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading
                  ? (mode === 'signup' ? 'Creating account...' : 'Please wait...')
                  : mode === 'login'
                  ? 'Log in'
                  : mode === 'signup'
                  ? 'Start free trial'
                  : 'Send reset link'}
              </button>
            </form>

            {mode === 'login' && (
              <div className="flex items-center justify-between mt-4">
                <button
                  onClick={() => goTo('reset')}
                  className="text-sm text-gray-400 hover:text-gray-600 transition-colors"
                >
                  Forgot password?
                </button>
                <button
                  onClick={() => goTo('landing')}
                  className="text-sm text-gray-400 hover:text-gray-600 transition-colors"
                >
                  Back
                </button>
              </div>
            )}
            {mode === 'signup' && (
              <div className="text-center mt-4">
                <button
                  onClick={() => goTo('landing')}
                  className="text-sm text-gray-400 hover:text-gray-600 transition-colors"
                >
                  Back
                </button>
              </div>
            )}
          </div>
        </div>

        <p className="text-center text-xs text-gray-300 mt-6">Plan your trade. Trade your plan.</p>
      </div>
    </div>
  )
}

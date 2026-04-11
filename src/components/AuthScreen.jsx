import React, { useState } from 'react'
import { supabase } from '../lib/supabaseClient'

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

const FEATURES = [
  {
    icon: (
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
    ),
    text: 'Sync every execution from IBKR automatically — trades, positions, P&L.',
  },
  {
    icon: (
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
    ),
    text: 'Plan trades with entry, target and stop — then match them to real executions.',
  },
  {
    icon: (
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M11 3.055A9.001 9.001 0 1020.945 13H11V3.055z M20.488 9H15V3.512A9.025 9.025 0 0120.488 9z" />
    ),
    text: 'Track win rate, R-multiples, and P&L across any date range, in your base currency.',
  },
]

export default function AuthScreen() {
  // 'landing' | 'signup' | 'login' | 'reset'
  const [mode, setMode] = useState('landing')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [message, setMessage] = useState(null)

  const clearFeedback = () => { setError(null); setMessage(null) }
  const goTo = (m) => { setMode(m); clearFeedback() }

  const handleSignup = async (e) => {
    e.preventDefault()
    clearFeedback()
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return }
    setLoading(true)
    try {
      const { data, error: signUpError } = await supabase.auth.signUp({ email, password })
      if (signUpError) { setError(signUpError.message); setLoading(false); return }
      if (!data.session) {
        setError('Signup requires email confirmation to be disabled in Supabase Auth settings.')
        setLoading(false)
        return
      }
      const url = await callCheckoutSession(data.session.access_token)
      window.location.href = url
    } catch (err) {
      setError(err.message)
      setLoading(false)
    }
  }

  const handleLogin = async (e) => {
    e.preventDefault()
    clearFeedback()
    setLoading(true)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) setError(error.message)
    setLoading(false)
  }

  const handleReset = async (e) => {
    e.preventDefault()
    clearFeedback()
    setLoading(true)
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    })
    if (error) { setError(error.message) } else { setMessage('Reset link sent. Check your inbox.') }
    setLoading(false)
  }

  // ── Shared form fields ────────────────────────────────────────────────────────
  const emailField = (
    <div>
      <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
        Email
      </label>
      <input
        type="email" required value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@example.com"
        className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-gray-50 text-gray-900 placeholder-gray-300"
      />
    </div>
  )

  const passwordField = (placeholder = '••••••••') => (
    <div>
      <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
        Password
      </label>
      <input
        type="password" required value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder={placeholder}
        className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-gray-50 text-gray-900 placeholder-gray-300"
      />
    </div>
  )

  const feedbackBlock = (
    <>
      {error && <div className="bg-red-50 border border-red-100 rounded-xl px-4 py-3 text-sm text-red-600">{error}</div>}
      {message && <div className="bg-green-50 border border-green-100 rounded-xl px-4 py-3 text-sm text-green-700">{message}</div>}
    </>
  )

  // ── Landing ───────────────────────────────────────────────────────────────────
  if (mode === 'landing') {
    return (
      <div className="min-h-screen bg-white flex flex-col items-center justify-center px-6 py-16">
        <div className="w-full max-w-md">

          {/* Header */}
          <div className="mb-10">
            <div className="flex items-center gap-2.5 mb-4">
              <div className="w-9 h-9 bg-blue-600 rounded-xl flex items-center justify-center flex-shrink-0">
                <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                </svg>
              </div>
              <span className="text-2xl font-bold text-gray-900 tracking-tight">CT3000</span>
            </div>
            <h1 className="text-3xl font-bold text-gray-900 leading-tight mb-2">
              Trading co-pilot for<br />IBKR traders.
            </h1>
            <p className="text-base text-gray-400">
              Stop trading blind. Sync your IBKR account, plan every entry, and review every trade.
            </p>
          </div>

          {/* Feature bullets */}
          <ul className="space-y-4 mb-10">
            {FEATURES.map(({ icon, text }, i) => (
              <li key={i} className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <svg className="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    {icon}
                  </svg>
                </div>
                <p className="text-sm text-gray-600 leading-relaxed">{text}</p>
              </li>
            ))}
          </ul>

          {/* Pricing + CTA */}
          <div className="bg-gray-50 rounded-2xl p-6 border border-gray-100">
            <div className="mb-4">
              <span className="text-2xl font-bold text-gray-900">$30</span>
              <span className="text-sm text-gray-400 ml-1">/month</span>
              <p className="text-sm text-gray-400 mt-0.5">7-day free trial. Cancel anytime.</p>
            </div>
            <button
              onClick={() => goTo('signup')}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3.5 rounded-xl text-sm transition-colors"
            >
              Start free trial
            </button>
            <p className="text-center text-sm text-gray-400 mt-4">
              Already have an account?{' '}
              <button
                onClick={() => goTo('login')}
                className="text-blue-600 font-medium hover:underline"
              >
                Log in
              </button>
            </p>
          </div>

        </div>
      </div>
    )
  }

  // ── Signup form ───────────────────────────────────────────────────────────────
  if (mode === 'signup') {
    return (
      <div className="min-h-screen bg-white flex flex-col items-center justify-center px-6 py-16">
        <div className="w-full max-w-md">

          <div className="flex items-center gap-2.5 mb-8">
            <div className="w-9 h-9 bg-blue-600 rounded-xl flex items-center justify-center flex-shrink-0">
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
              </svg>
            </div>
            <span className="text-xl font-bold text-gray-900">CT3000</span>
          </div>

          <h2 className="text-2xl font-bold text-gray-900 mb-1">Create your account</h2>
          <p className="text-sm text-gray-400 mb-8">
            After signup you'll go straight to checkout — 7-day free trial, then $30/month.
          </p>

          <form onSubmit={handleSignup} className="space-y-4">
            {emailField}
            {passwordField('Min 8 characters')}
            {feedbackBlock}
            <button
              type="submit" disabled={loading}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3.5 rounded-xl text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Please wait...' : 'Sign up & go to checkout'}
            </button>
          </form>

          <p className="text-center text-sm text-gray-400 mt-6">
            Already have an account?{' '}
            <button onClick={() => goTo('login')} className="text-blue-600 font-medium hover:underline">
              Log in
            </button>
          </p>
          <div className="text-center mt-3">
            <button onClick={() => goTo('landing')} className="text-xs text-gray-300 hover:text-gray-500 transition-colors">
              ← Back
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ── Login form ────────────────────────────────────────────────────────────────
  if (mode === 'login') {
    return (
      <div className="min-h-screen bg-white flex flex-col items-center justify-center px-6 py-16">
        <div className="w-full max-w-md">

          <div className="flex items-center gap-2.5 mb-8">
            <div className="w-9 h-9 bg-blue-600 rounded-xl flex items-center justify-center flex-shrink-0">
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
              </svg>
            </div>
            <span className="text-xl font-bold text-gray-900">CT3000</span>
          </div>

          <h2 className="text-2xl font-bold text-gray-900 mb-1">Welcome back</h2>
          <p className="text-sm text-gray-400 mb-8">Log in to your account.</p>

          <form onSubmit={handleLogin} className="space-y-4">
            {emailField}
            {passwordField()}
            {feedbackBlock}
            <button
              type="submit" disabled={loading}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3.5 rounded-xl text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Please wait...' : 'Log in'}
            </button>
          </form>

          <div className="flex items-center justify-between mt-6">
            <button onClick={() => goTo('reset')} className="text-sm text-gray-400 hover:text-gray-600 transition-colors">
              Forgot password?
            </button>
            <button onClick={() => goTo('landing')} className="text-xs text-gray-300 hover:text-gray-500 transition-colors">
              ← Back
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ── Reset form ────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-white flex flex-col items-center justify-center px-6 py-16">
      <div className="w-full max-w-md">

        <div className="flex items-center gap-2.5 mb-8">
          <div className="w-9 h-9 bg-blue-600 rounded-xl flex items-center justify-center flex-shrink-0">
            <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
            </svg>
          </div>
          <span className="text-xl font-bold text-gray-900">CT3000</span>
        </div>

        <h2 className="text-2xl font-bold text-gray-900 mb-1">Reset password</h2>
        <p className="text-sm text-gray-400 mb-8">We'll send a reset link to your email.</p>

        <form onSubmit={handleReset} className="space-y-4">
          {emailField}
          {feedbackBlock}
          <button
            type="submit" disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3.5 rounded-xl text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? 'Please wait...' : 'Send reset link'}
          </button>
        </form>

        <div className="text-center mt-6">
          <button onClick={() => goTo('login')} className="text-sm text-gray-400 hover:text-gray-600 transition-colors">
            ← Back to login
          </button>
        </div>
      </div>
    </div>
  )
}

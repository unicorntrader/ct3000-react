import React, { useState } from 'react'
import { supabase } from '../lib/supabaseClient'

const FEATURES = [
  'Sync every execution from IBKR automatically — trades, positions, P&L.',
  'Plan trades with entry, target and stop — then match them to real executions.',
  'Track win rate, R-multiples, and P&L across any date range, in your base currency.',
]

function Logo() {
  return (
    <div className="flex items-center gap-2.5">
      <div className="w-9 h-9 bg-blue-600 rounded-xl flex items-center justify-center flex-shrink-0">
        <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
        </svg>
      </div>
      <span className="text-xl font-bold text-gray-900">CT3000</span>
    </div>
  )
}

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

export default function AuthScreen() {
  // 'landing' | 'signup' | 'login' | 'reset'
  const [mode, setMode] = useState('landing')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [message, setMessage] = useState(null)

  const reset = (nextMode) => { setMode(nextMode); setError(null); setMessage(null) }

  const handleSignup = async (e) => {
    e.preventDefault()
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return }
    setError(null)
    setLoading(true)
    try {
      const { data, error: signUpError } = await supabase.auth.signUp({ email, password })
      if (signUpError) { setError(signUpError.message); setLoading(false); return }
      if (!data.session) {
        // Email confirmation is enabled — direct users to disable it
        setError('Account created but no session returned. Disable "Confirm email" in Supabase Auth → Settings, then try again.')
        setLoading(false)
        return
      }
      // Immediately create checkout session and redirect — user never sees the app
      const url = await createCheckoutSession(data.session.access_token)
      window.location.href = url
      // Don't setLoading(false) — we're navigating away
    } catch (err) {
      setError(err.message)
      setLoading(false)
    }
  }

  const handleLogin = async (e) => {
    e.preventDefault()
    setError(null)
    setLoading(true)
    const { error: loginError } = await supabase.auth.signInWithPassword({ email, password })
    if (loginError) setError(loginError.message)
    setLoading(false)
    // On success, App.jsx's onAuthStateChange fires and handles subscription check
  }

  const handleReset = async (e) => {
    e.preventDefault()
    setError(null)
    setLoading(true)
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    })
    if (resetError) { setError(resetError.message) }
    else { setMessage('Reset link sent. Check your inbox.') }
    setLoading(false)
  }

  const inputClass = "w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-gray-50 text-gray-900 placeholder-gray-300"
  const labelClass = "block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5"
  const btnPrimary = "w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3.5 rounded-xl text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"

  // ── Landing ───────────────────────────────────────────────────────────────────
  if (mode === 'landing') {
    return (
      <div className="min-h-screen bg-white flex flex-col items-center justify-center px-6 py-16">
        <div className="w-full max-w-md">

          <div className="mb-10">
            <div className="mb-5"><Logo /></div>
            <h1 className="text-3xl font-bold text-gray-900 leading-tight mb-2">
              Trading co-pilot for<br />IBKR traders.
            </h1>
            <p className="text-base text-gray-400">
              Stop trading blind. Sync your IBKR account, plan every entry, and review every trade.
            </p>
          </div>

          <ul className="space-y-4 mb-10">
            {FEATURES.map((text, i) => (
              <li key={i} className="flex items-start gap-3">
                <div className="w-5 h-5 rounded-full bg-blue-50 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <svg className="w-3 h-3 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <p className="text-sm text-gray-600 leading-relaxed">{text}</p>
              </li>
            ))}
          </ul>

          <div className="bg-gray-50 rounded-2xl p-6 border border-gray-100">
            <div className="mb-5">
              <span className="text-2xl font-bold text-gray-900">$30</span>
              <span className="text-sm text-gray-400 ml-1">/month</span>
              <p className="text-sm text-gray-400 mt-0.5">7-day free trial. Cancel anytime.</p>
            </div>
            <button onClick={() => reset('signup')} className={btnPrimary}>
              Start free trial
            </button>
            <p className="text-center text-sm text-gray-400 mt-4">
              Already have an account?{' '}
              <button onClick={() => reset('login')} className="text-blue-600 font-medium hover:underline">
                Log in
              </button>
            </p>
          </div>

        </div>
      </div>
    )
  }

  // ── Signup ────────────────────────────────────────────────────────────────────
  if (mode === 'signup') {
    return (
      <div className="min-h-screen bg-white flex flex-col items-center justify-center px-6 py-16">
        <div className="w-full max-w-md">
          <div className="mb-8"><Logo /></div>
          <h2 className="text-2xl font-bold text-gray-900 mb-1">Create your account</h2>
          <p className="text-sm text-gray-400 mb-8">
            After signup you'll go straight to checkout — 7-day free trial, then $30/month.
          </p>
          <form onSubmit={handleSignup} className="space-y-4">
            <div>
              <label className={labelClass}>Email</label>
              <input type="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Password</label>
              <input type="password" required value={password} onChange={e => setPassword(e.target.value)} placeholder="Min 8 characters" className={inputClass} />
            </div>
            {error && <div className="bg-red-50 border border-red-100 rounded-xl px-4 py-3 text-sm text-red-600">{error}</div>}
            <button type="submit" disabled={loading} className={btnPrimary}>
              {loading ? 'Please wait…' : 'Sign up & go to checkout'}
            </button>
          </form>
          <p className="text-center text-sm text-gray-400 mt-6">
            Already have an account?{' '}
            <button onClick={() => reset('login')} className="text-blue-600 font-medium hover:underline">Log in</button>
          </p>
          <div className="text-center mt-3">
            <button onClick={() => reset('landing')} className="text-xs text-gray-300 hover:text-gray-500 transition-colors">← Back</button>
          </div>
        </div>
      </div>
    )
  }

  // ── Login ─────────────────────────────────────────────────────────────────────
  if (mode === 'login') {
    return (
      <div className="min-h-screen bg-white flex flex-col items-center justify-center px-6 py-16">
        <div className="w-full max-w-md">
          <div className="mb-8"><Logo /></div>
          <h2 className="text-2xl font-bold text-gray-900 mb-1">Welcome back</h2>
          <p className="text-sm text-gray-400 mb-8">Log in to your account.</p>
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className={labelClass}>Email</label>
              <input type="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Password</label>
              <input type="password" required value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" className={inputClass} />
            </div>
            {error && <div className="bg-red-50 border border-red-100 rounded-xl px-4 py-3 text-sm text-red-600">{error}</div>}
            {message && <div className="bg-green-50 border border-green-100 rounded-xl px-4 py-3 text-sm text-green-700">{message}</div>}
            <button type="submit" disabled={loading} className={btnPrimary}>
              {loading ? 'Please wait…' : 'Log in'}
            </button>
          </form>
          <div className="flex items-center justify-between mt-5">
            <button onClick={() => reset('reset')} className="text-sm text-gray-400 hover:text-gray-600 transition-colors">Forgot password?</button>
            <button onClick={() => reset('landing')} className="text-xs text-gray-300 hover:text-gray-500 transition-colors">← Back</button>
          </div>
        </div>
      </div>
    )
  }

  // ── Reset ─────────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-white flex flex-col items-center justify-center px-6 py-16">
      <div className="w-full max-w-md">
        <div className="mb-8"><Logo /></div>
        <h2 className="text-2xl font-bold text-gray-900 mb-1">Reset password</h2>
        <p className="text-sm text-gray-400 mb-8">We'll send a reset link to your email.</p>
        <form onSubmit={handleReset} className="space-y-4">
          <div>
            <label className={labelClass}>Email</label>
            <input type="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" className={inputClass} />
          </div>
          {error && <div className="bg-red-50 border border-red-100 rounded-xl px-4 py-3 text-sm text-red-600">{error}</div>}
          {message && <div className="bg-green-50 border border-green-100 rounded-xl px-4 py-3 text-sm text-green-700">{message}</div>}
          <button type="submit" disabled={loading} className={btnPrimary}>
            {loading ? 'Please wait…' : 'Send reset link'}
          </button>
        </form>
        <div className="text-center mt-6">
          <button onClick={() => reset('login')} className="text-sm text-gray-400 hover:text-gray-600 transition-colors">← Back to login</button>
        </div>
      </div>
    </div>
  )
}

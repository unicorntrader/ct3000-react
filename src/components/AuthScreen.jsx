import React, { useState } from 'react'
import { supabase } from '../lib/supabaseClient'

export default function AuthScreen() {
  const [mode, setMode] = useState('login') // 'login' | 'signup' | 'reset'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [message, setMessage] = useState(null)

  const clearFeedback = () => { setError(null); setMessage(null) }

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
    const { error } = await supabase.auth.signUp({ email, password })
    if (error) {
      setError(error.message)
    } else {
      setMessage('Account created. Check your email to confirm, then log in.')
      setMode('login')
    }
    setLoading(false)
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

  const submitHandler = mode === 'login' ? handleLogin : mode === 'signup' ? handleSignup : handleReset

  return (
    <div className="min-h-screen bg-black flex flex-col items-center justify-center px-4">
      {/* Background grid */}
      <div
        className="fixed inset-0 pointer-events-none"
        style={{
          backgroundImage:
            'linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px)',
          backgroundSize: '40px 40px',
        }}
      />

      <div className="relative w-full max-w-sm">
        {/* Logo / wordmark */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center gap-2 mb-3">
            <div className="w-7 h-7 bg-white flex items-center justify-center">
              <span className="text-black font-black text-xs tracking-tight">CT</span>
            </div>
            <span
              className="text-white font-black text-2xl tracking-widest"
              style={{ fontFamily: "'Courier New', monospace", letterSpacing: '0.25em' }}
            >
              3000
            </span>
          </div>
          <p className="text-zinc-500 text-xs tracking-[0.2em] uppercase">
            Plan Your Trade. Trade Your Plan.
          </p>
        </div>

        {/* Card */}
        <div className="bg-zinc-950 border border-zinc-800 p-8">
          {/* Mode tabs */}
          <div className="flex border-b border-zinc-800 mb-8 -mx-8 px-8">
            {['login', 'signup'].map((m) => (
              <button
                key={m}
                onClick={() => { setMode(m); clearFeedback() }}
                className={`pb-3 mr-6 text-xs tracking-widest uppercase font-semibold transition-colors border-b-2 -mb-px ${
                  mode === m
                    ? 'text-white border-white'
                    : 'text-zinc-500 border-transparent hover:text-zinc-300'
                }`}
              >
                {m}
              </button>
            ))}
          </div>

          {mode === 'reset' && (
            <div className="mb-6">
              <p className="text-zinc-400 text-sm">
                Enter your email and we'll send a reset link.
              </p>
            </div>
          )}

          <form onSubmit={submitHandler} className="space-y-4">
            <div>
              <label className="block text-xs text-zinc-500 tracking-widest uppercase mb-2">
                Email
              </label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full bg-black border border-zinc-700 text-white text-sm px-3 py-2.5 focus:outline-none focus:border-zinc-400 transition-colors placeholder-zinc-700"
                style={{ fontFamily: "'Courier New', monospace" }}
              />
            </div>

            {mode !== 'reset' && (
              <div>
                <label className="block text-xs text-zinc-500 tracking-widest uppercase mb-2">
                  Password
                </label>
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={mode === 'signup' ? 'Min 8 characters' : '••••••••'}
                  className="w-full bg-black border border-zinc-700 text-white text-sm px-3 py-2.5 focus:outline-none focus:border-zinc-400 transition-colors placeholder-zinc-700"
                  style={{ fontFamily: "'Courier New', monospace" }}
                />
              </div>
            )}

            {/* Feedback */}
            {error && (
              <div className="border border-red-900 bg-red-950/40 px-3 py-2 text-red-400 text-xs">
                {error}
              </div>
            )}
            {message && (
              <div className="border border-green-900 bg-green-950/40 px-3 py-2 text-green-400 text-xs">
                {message}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-white text-black text-xs font-black tracking-widest uppercase py-3 hover:bg-zinc-200 transition-colors disabled:opacity-40 disabled:cursor-not-allowed mt-2"
            >
              {loading
                ? '...'
                : mode === 'login'
                ? 'Log In'
                : mode === 'signup'
                ? 'Create Account'
                : 'Send Reset Link'}
            </button>
          </form>

          {/* Forgot password / back links */}
          <div className="mt-5 text-center">
            {mode === 'login' && (
              <button
                onClick={() => { setMode('reset'); clearFeedback() }}
                className="text-xs text-zinc-600 hover:text-zinc-400 transition-colors"
              >
                Forgot password?
              </button>
            )}
            {mode === 'reset' && (
              <button
                onClick={() => { setMode('login'); clearFeedback() }}
                className="text-xs text-zinc-600 hover:text-zinc-400 transition-colors"
              >
                ← Back to login
              </button>
            )}
          </div>
        </div>

        <p className="text-center text-zinc-700 text-xs mt-6 tracking-widest">
          IBKR TRADING CO-PILOT
        </p>
      </div>
    </div>
  )
}

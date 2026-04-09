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
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-sm">

        {/* Logo */}
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

        {/* Card */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">

          {/* Tabs */}
          {mode !== 'reset' && (
            <div className="flex border-b border-gray-100">
              {['login', 'signup'].map((m) => (
                <button
                  key={m}
                  onClick={() => { setMode(m); clearFeedback() }}
                  className={`flex-1 py-3.5 text-sm font-medium transition-colors ${
                    mode === m
                      ? 'text-blue-600 border-b-2 border-blue-600 -mb-px bg-white'
                      : 'text-gray-400 hover:text-gray-600'
                  }`}
                >
                  {m === 'login' ? 'Log in' : 'Sign up'}
                </button>
              ))}
            </div>
          )}

          <div className="px-6 py-6">
            {mode === 'reset' && (
              <div className="mb-5">
                <button
                  onClick={() => { setMode('login'); clearFeedback() }}
                  className="flex items-center space-x-1 text-sm text-gray-400 hover:text-gray-600 mb-4"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                  <span>Back to login</span>
                </button>
                <h3 className="text-base font-semibold text-gray-900 mb-1">Reset password</h3>
                <p className="text-sm text-gray-400">We'll send a reset link to your email.</p>
              </div>
            )}

            <form onSubmit={submitHandler} className="space-y-4">
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
                  ? 'Please wait...'
                  : mode === 'login'
                  ? 'Log in'
                  : mode === 'signup'
                  ? 'Create account'
                  : 'Send reset link'}
              </button>
            </form>

            {mode === 'login' && (
              <div className="text-center mt-4">
                <button
                  onClick={() => { setMode('reset'); clearFeedback() }}
                  className="text-sm text-gray-400 hover:text-gray-600 transition-colors"
                >
                  Forgot password?
                </button>
              </div>
            )}
          </div>
        </div>

        <p className="text-center text-xs text-gray-300 mt-6">
          Plan your trade. Trade your plan.
        </p>
      </div>
    </div>
  )
}

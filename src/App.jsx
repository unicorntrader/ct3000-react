import React, { useState, useEffect, useCallback } from 'react'
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom'
import { supabase } from './lib/supabaseClient'
import { PrivacyProvider } from './lib/PrivacyContext'
import AuthScreen from './components/AuthScreen'
import PaywallScreen from './screens/PaywallScreen'
import Header from './components/Header'
import MobileNav from './components/MobileNav'
import Sidebar from './components/Sidebar'
import PlanSheet from './components/PlanSheet'
import ReviewSheet from './components/ReviewSheet'

import HomeScreen from './screens/HomeScreen'
import PlansScreen from './screens/PlansScreen'
import DailyViewScreen from './screens/DailyViewScreen'
import JournalScreen from './screens/JournalScreen'
import PerformanceScreen from './screens/PerformanceScreen'
import IBKRScreen from './screens/IBKRScreen'
import SettingsScreen from './screens/SettingsScreen'

// Captured once at module load — URL params don't change during the session
const CHECKOUT_SUCCESS = new URLSearchParams(window.location.search).get('checkout') === 'success'

function isActive(sub) {
  if (!sub) return false
  const { subscription_status, trial_ends_at, current_period_ends_at } = sub
  if (subscription_status === 'active') return true
  if (subscription_status === 'trialing') {
    const endsAt = trial_ends_at || current_period_ends_at
    // If Stripe says trialing but dates aren't populated yet, trust the status
    return !endsAt || new Date(endsAt) > new Date()
  }
  return false
}

function LoadingScreen({ message }) {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
          <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
          </svg>
        </div>
        <div className="w-4 h-4 border-2 border-gray-200 border-t-blue-600 rounded-full animate-spin" />
        {message && <p className="text-sm text-gray-500 mt-1">{message}</p>}
      </div>
    </div>
  )
}

function AppShell({ session }) {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [planSheetOpen, setPlanSheetOpen] = useState(false)
  const [reviewSheetOpen, setReviewSheetOpen] = useState(false)
  const [reviewDismissed, setReviewDismissed] = useState(false)
  const [planRefreshKey, setPlanRefreshKey] = useState(0)
  const [editingPlan, setEditingPlan] = useState(null)

  const handleSignOut = async () => { await supabase.auth.signOut() }

  return (
    <div className="min-h-screen bg-gray-50">
      <Header onMenuOpen={() => setSidebarOpen(true)} />
      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} onSignOut={handleSignOut} session={session} />
      <PlanSheet session={session} isOpen={planSheetOpen} plan={editingPlan} onClose={() => { setPlanSheetOpen(false); setEditingPlan(null) }} onSaved={() => setPlanRefreshKey(k => k + 1)} />
      <ReviewSheet session={session} isOpen={reviewSheetOpen} onClose={() => setReviewSheetOpen(false)} onComplete={() => setReviewDismissed(true)} />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 pb-24 md:pb-6">
        <Routes>
          <Route path="/"            element={<HomeScreen session={session} onReviewOpen={() => setReviewSheetOpen(true)} reviewDismissed={reviewDismissed} />} />
          <Route path="/plans"       element={<PlansScreen session={session} onNewPlan={() => setPlanSheetOpen(true)} onEditPlan={(plan) => { setEditingPlan(plan); setPlanSheetOpen(true) }} refreshKey={planRefreshKey} />} />
          <Route path="/daily"       element={<DailyViewScreen session={session} />} />
          <Route path="/journal"     element={<JournalScreen session={session} />} />
          <Route path="/performance" element={<PerformanceScreen session={session} />} />
          <Route path="/ibkr"        element={<IBKRScreen session={session} />} />
          <Route path="/settings"    element={<SettingsScreen session={session} />} />
          <Route path="*"            element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      <MobileNav />
    </div>
  )
}

export default function App() {
  const [session, setSession] = useState(undefined)     // undefined = still loading
  const [subscription, setSubscription] = useState(undefined) // undefined = still loading
  const [polling, setPolling] = useState(false)
  const [pollTimedOut, setPollTimedOut] = useState(false)

  const fetchSubscription = useCallback(async (userId) => {
    console.log('[app] fetchSubscription for userId:', userId)
    const { data, error } = await supabase
      .from('user_subscriptions')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle()
    if (error) {
      console.error('[app] subscription fetch error:', error.message)
      setSubscription(null)
      return null
    }
    console.log('[app] subscription row:', data)
    setSubscription(data ?? null)
    return data
  }, [])

  // Auth state
  useEffect(() => {
    const { data: { subscription: authSub } } = supabase.auth.onAuthStateChange((_event, session) => {
      console.log('[app] auth event:', _event, '| userId:', session?.user?.id ?? 'none')
      setSession(session)
      if (session?.user?.id) {
        fetchSubscription(session.user.id)
      } else {
        setSubscription(null)
      }
    })
    return () => authSub.unsubscribe()
  }, [fetchSubscription])

  // Re-check subscription on window focus (e.g. user switches tabs back)
  useEffect(() => {
    const onFocus = () => {
      supabase.auth.getSession().then(({ data: { session } }) => {
        if (session?.user?.id) fetchSubscription(session.user.id)
      })
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [fetchSubscription])

  // Poll after Stripe redirect (?checkout=success)
  useEffect(() => {
    if (!CHECKOUT_SUCCESS || !session?.user?.id) return

    console.log('[app] ?checkout=success detected — starting subscription poll')
    setPolling(true)
    // Clean up URL immediately
    window.history.replaceState({}, '', window.location.pathname)

    let attempts = 0
    const MAX_ATTEMPTS = 15 // 15 × 2s = 30s

    const interval = setInterval(async () => {
      attempts++
      console.log('[app] poll attempt', attempts)
      const { data, error } = await supabase
        .from('user_subscriptions')
        .select('*')
        .eq('user_id', session.user.id)
        .maybeSingle()

      if (error) {
        console.error('[app] poll error:', error.message)
      } else if (data && isActive(data)) {
        console.log('[app] subscription active — stopping poll, status:', data.subscription_status)
        setSubscription(data)
        setPolling(false)
        clearInterval(interval)
        return
      }

      if (attempts >= MAX_ATTEMPTS) {
        console.warn('[app] poll timed out after', MAX_ATTEMPTS, 'attempts')
        setSubscription(data ?? null)
        setPolling(false)
        setPollTimedOut(true)
        clearInterval(interval)
      }
    }, 2000)

    return () => clearInterval(interval)
  }, [CHECKOUT_SUCCESS, session?.user?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Render ────────────────────────────────────────────────────────────────────

  // Auth or subscription still loading
  if (session === undefined || (session !== null && subscription === undefined)) {
    return <LoadingScreen />
  }

  // Not logged in
  if (!session) {
    return <AuthScreen />
  }

  // Waiting for Stripe webhook to fire after checkout
  if (polling) {
    return <LoadingScreen message="Welcome! Setting up your account…" />
  }

  // Webhook timed out — show paywall with a note
  if (pollTimedOut && !isActive(subscription)) {
    return <PaywallScreen timedOut />
  }

  // Active or trialing subscription
  if (isActive(subscription)) {
    return (
      <PrivacyProvider>
        <AppShell session={session} />
      </PrivacyProvider>
    )
  }

  // No subscription, pending, or canceled
  return <PaywallScreen />
}

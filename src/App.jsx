import React, { useState, useEffect, useCallback } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import * as Sentry from '@sentry/react'
import { supabase } from './lib/supabaseClient'
import { PrivacyProvider } from './lib/PrivacyContext'
import { BaseCurrencyProvider } from './lib/BaseCurrencyContext'
import { CodeLabelProvider } from './lib/CodeLabelContext'
import CodeLabel from './components/CodeLabel'
import CodeLabelToggle from './components/CodeLabelToggle'
import CodeLabelLegend from './components/CodeLabelLegend'
import ScreenFrame from './components/ScreenFrame'
import ErrorBoundary from './components/ErrorBoundary'
import AuthScreen from './components/AuthScreen'
import PaywallScreen from './screens/PaywallScreen'
import Header from './components/Header'
import MobileNav from './components/MobileNav'
import Sidebar from './components/Sidebar'
import PlanSheet from './components/PlanSheet'
import DemoBanner from './components/DemoBanner'

import HomeScreen from './screens/HomeScreen'
import PlansScreen from './screens/PlansScreen'
import DailyViewScreen from './screens/DailyViewScreen'
import JournalScreen from './screens/JournalScreen'
import PerformanceScreen from './screens/PerformanceScreen'
import IBKRScreen from './screens/IBKRScreen'
import SettingsScreen from './screens/SettingsScreen'
import ReviewScreen from './screens/ReviewScreen'

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

function AppShell({ session, subscription, onSubscriptionRefresh }) {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [planSheetOpen, setPlanSheetOpen] = useState(false)
  const [planRefreshKey, setPlanRefreshKey] = useState(0)
  const [editingPlan, setEditingPlan] = useState(null)

  const handleSignOut = async () => { await supabase.auth.signOut() }

  // Banner shown to signed-up users who have demo data but haven't yet
  // connected IBKR. Flips off automatically once api/sync.js sets
  // ibkr_connected=true and deletes the is_demo rows.
  const showDemoBanner = subscription?.demo_seeded && !subscription?.ibkr_connected

  return (
    <div className="min-h-screen bg-gray-50">
      <CodeLabel name="Header" file="components/Header.jsx" type="component">
        <Header onMenuOpen={() => setSidebarOpen(true)} />
      </CodeLabel>
      {showDemoBanner && (
        <CodeLabel name="DemoBanner" file="components/DemoBanner.jsx" type="component">
          <DemoBanner />
        </CodeLabel>
      )}
      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} onSignOut={handleSignOut} session={session} />
      <PlanSheet session={session} isOpen={planSheetOpen} plan={editingPlan} onClose={() => { setPlanSheetOpen(false); setEditingPlan(null) }} onSaved={() => setPlanRefreshKey(k => k + 1)} />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 pb-24 md:pb-6">
        <Routes>
          <Route path="/" element={
            <ScreenFrame
              name="HomeScreen"
              file="src/screens/HomeScreen.jsx"
              db={['open_positions', 'planned_trades', 'logical_trades']}
              notes="Landing page. Shows today's P&L, open positions, active plans, and a preview of recent logical trades."
            >
              <HomeScreen session={session} />
            </ScreenFrame>
          } />
          <Route path="/plans" element={
            <ScreenFrame
              name="PlansScreen"
              file="src/screens/PlansScreen.jsx"
              db={['planned_trades', 'playbooks', 'missed_trades', 'logical_trades']}
              notes="Plans / Playbooks / Missed Trades tabs. Opens PlanSheet drawer to create/edit plans."
            >
              <PlansScreen session={session} onNewPlan={() => setPlanSheetOpen(true)} onEditPlan={(plan) => { setEditingPlan(plan); setPlanSheetOpen(true) }} refreshKey={planRefreshKey} />
            </ScreenFrame>
          } />
          <Route path="/daily" element={
            <ScreenFrame
              name="DailyViewScreen"
              file="src/screens/DailyViewScreen.jsx"
              db={['logical_trades', 'trades', 'daily_notes', 'user_ibkr_credentials']}
              notes="Per-day breakdown. Each DayBlock lists trades with expandable ExecSubTable drill-down showing raw executions."
            >
              <DailyViewScreen session={session} />
            </ScreenFrame>
          } />
          <Route path="/journal" element={
            <ScreenFrame
              name="JournalScreen"
              file="src/screens/JournalScreen.jsx"
              db={['logical_trades', 'planned_trades', 'playbooks']}
              notes="Smart Journal table. Expandable TradeInlineDetail rows. Bulk actions for needs_review. calcR() computes R-multiple."
            >
              <JournalScreen session={session} />
            </ScreenFrame>
          } />
          <Route path="/performance" element={
            <ScreenFrame
              name="PerformanceScreen"
              file="src/screens/PerformanceScreen.jsx"
              db={['logical_trades', 'user_ibkr_credentials']}
              notes="Charts + KPI dashboard. pnlBase() converts native P&L to account base currency using fx_rate_to_base."
            >
              <PerformanceScreen session={session} />
            </ScreenFrame>
          } />
          <Route path="/ibkr" element={
            <ScreenFrame
              name="IBKRScreen"
              file="src/screens/IBKRScreen.jsx"
              db={['user_ibkr_credentials', 'trades', 'logical_trades']}
              notes="IBKR connection + Sync Now / Rebuild buttons. Calls api/sync.js and api/rebuild.js serverless functions."
            >
              <IBKRScreen session={session} />
            </ScreenFrame>
          } />
          <Route path="/settings" element={
            <ScreenFrame
              name="SettingsScreen"
              file="src/screens/SettingsScreen.jsx"
              db={['user_subscriptions', 'user_ibkr_credentials']}
              notes="Account / billing / base currency. Stripe portal link for subscription management."
            >
              <SettingsScreen session={session} />
            </ScreenFrame>
          } />
          <Route path="/review" element={
            <ScreenFrame
              name="ReviewScreen"
              file="src/screens/ReviewScreen.jsx"
              db={['weekly_reviews', 'logical_trades']}
              notes="Weekly retrospective: worked / didnt_work / recurring / action notes per ISO week."
            >
              <ReviewScreen session={session} />
            </ScreenFrame>
          } />
          {/* /signup is the route ct3000-admin uses for invite links
              (https://.../signup?invite=TOKEN). Logged-out users never hit this
              route — App.jsx returns <AuthScreen /> directly when session is null,
              and AuthScreen reads ?invite= from window.location.search regardless
              of path. This route only matters when a user is ALREADY logged in and
              clicks an invite link: they can't redeem it without signing out first,
              so we just send them home. Explicit route avoids relying on the
              catch-all wildcard's accidental behavior. */}
          <Route path="/signup"      element={<Navigate to="/" replace />} />
          <Route path="*"            element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      <CodeLabel name="MobileNav" file="components/MobileNav.jsx" type="component">
        <MobileNav />
      </CodeLabel>
    </div>
  )
}

export default function App() {
  const [session, setSession] = useState(undefined)     // undefined = still loading
  const [subscription, setSubscription] = useState(undefined) // undefined = still loading
  const [polling, setPolling] = useState(false)
  const [pollTimedOut, setPollTimedOut] = useState(false)

  // Calls /api/seed-demo for the current session. Safe to call repeatedly --
  // the endpoint short-circuits if demo data already exists. Used on first
  // login for newly signed-up users so they have something to explore while
  // the IBKR connection step is still ahead of them.
  const seedDemoData = useCallback(async (session) => {
    try {
      const res = await fetch('/api/seed-demo', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${session.access_token}` },
      })
      if (!res.ok) {
        console.error('[app] demo seed failed:', res.status)
      }
    } catch (err) {
      console.error('[app] demo seed error:', err?.message || err)
      // Non-fatal -- user just sees an empty app. Banner still points them
      // at IBKR to get real data in.
    }
  }, [])

  const fetchSubscription = useCallback(async (userId) => {
    // console.log('[app] fetchSubscription for userId:', userId)
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
    // console.log('[app] subscription row:', data)
    setSubscription(data ?? null)
    return data
  }, [])

  // Auth state
  useEffect(() => {
    const { data: { subscription: authSub } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
      // Tag Sentry events with the Supabase user so errors are attributable.
      if (session?.user?.id) {
        Sentry.setUser({
          id: session.user.id,
          ...(session.user.email ? { email: session.user.email } : {}),
        })
      } else {
        Sentry.setUser(null)
      }
      if (!session?.user?.id) {
        setSubscription(null)
        return
      }
      // Fetch subscription. If this is the user's first login and they
      // haven't connected IBKR yet, auto-seed demo data before surfacing
      // the app so they don't see an empty home screen for a flash.
      setSubscription(undefined)
      ;(async () => {
        // Peek without updating state — we don't want to flip the loading
        // gate off until the seeding decision is final.
        const { data: sub } = await supabase
          .from('user_subscriptions')
          .select('*')
          .eq('user_id', session.user.id)
          .maybeSingle()
        if (sub && !sub.demo_seeded && !sub.ibkr_connected) {
          await seedDemoData(session)
        }
        // Either path ends with a real fetch that updates subscription state
        // and flips the loading gate off.
        await fetchSubscription(session.user.id)
      })()
    })
    return () => authSub.unsubscribe()
  }, [fetchSubscription, seedDemoData])

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
  const pollingUserId = session?.user?.id
  useEffect(() => {
    if (!CHECKOUT_SUCCESS || !pollingUserId) return

    // console.log('[app] ?checkout=success detected — starting subscription poll')
    setPolling(true)
    window.history.replaceState({}, '', window.location.pathname)

    let attempts = 0
    const MAX_ATTEMPTS = 15 // 15 × 2s = 30s

    const interval = setInterval(async () => {
      attempts++
      // console.log('[app] poll attempt', attempts)
      const { data, error } = await supabase
        .from('user_subscriptions')
        .select('*')
        .eq('user_id', pollingUserId)
        .maybeSingle()

      if (error) {
        console.error('[app] poll error:', error.message)
      } else if (data && isActive(data)) {
        // console.log('[app] subscription active — stopping poll, status:', data.subscription_status)
        setSubscription(data)
        setPolling(false)
        clearInterval(interval)
        return
      }

      if (attempts >= MAX_ATTEMPTS) {
        // console.warn('[app] poll timed out after', MAX_ATTEMPTS, 'attempts')
        setSubscription(data ?? null)
        setPolling(false)
        setPollTimedOut(true)
        clearInterval(interval)
      }
    }, 2000)

    return () => clearInterval(interval)
  }, [pollingUserId])

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
      <ErrorBoundary>
        <CodeLabelProvider>
          <PrivacyProvider>
            <BaseCurrencyProvider userId={session.user.id}>
              <AppShell
                session={session}
                subscription={subscription}
                onSubscriptionRefresh={() => fetchSubscription(session.user.id)}
              />
              <CodeLabelLegend />
              <CodeLabelToggle />
            </BaseCurrencyProvider>
          </PrivacyProvider>
        </CodeLabelProvider>
      </ErrorBoundary>
    )
  }

  // No subscription, pending, or canceled
  return <PaywallScreen />
}

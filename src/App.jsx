import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import * as Sentry from '@sentry/react'
import { supabase } from './lib/supabaseClient'
import { PrivacyProvider } from './lib/PrivacyContext'
import { BaseCurrencyProvider } from './lib/BaseCurrencyContext'
import { DataVersionProvider } from './lib/DataVersionContext'
import ErrorBoundary from './components/ErrorBoundary'
import AuthScreen from './components/AuthScreen'
import MaintenanceScreen from './components/MaintenanceScreen'
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
import TermsScreen from './screens/TermsScreen'
import PrivacyScreen from './screens/PrivacyScreen'
import ResetPasswordScreen from './screens/ResetPasswordScreen'

// Captured once at module load — URL params don't change during the session
const CHECKOUT_SUCCESS = new URLSearchParams(window.location.search).get('checkout') === 'success'

function isActive(sub) {
  if (!sub) return false
  // Comp short-circuit. Mirrors api/_lib/requireActiveSubscription.js so the
  // client-side gate agrees with the server. Today every comp also carries
  // subscription_status='active' so the next branch would also return true,
  // but a stray non-active status on a comped row used to lock the user out
  // of the UI even though the API let them in.
  if (sub.is_comped) return true
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

  // ── Keep-alive navigation ────────────────────────────────────────────────
  // Default React Router behaviour is to unmount the previous route element
  // on every navigation. That triggers each screen's useEffect -> setLoading
  // -> fetch -> spinner on every tab switch, even for tabs already visited
  // in this session. We want first-visit cost (one spinner) + instant
  // returns with state preserved.
  //
  // The mechanism: render every visited screen once and keep it mounted,
  // toggling CSS display between block and none as the user navigates.
  // React state, scroll position, open expand sections, draft form text —
  // all preserved. URL and back/forward behaviour are unaffected because
  // we still live inside React Router and read the pathname from
  // useLocation. The Routes block below continues to handle /signup and
  // unknown-path redirects.
  //
  // Trade-off: data fetched on first visit isn't refreshed on return.
  // Known-stale-after-cross-screen-mutation cases (e.g. Home pipeline count
  // after resolving a trade on Journal) are not addressed here — follow-up
  // commit will add targeted silent refetch via a DataVersion context.
  const location = useLocation()
  const SCREENS = useMemo(() => [
    { path: '/',            element: <HomeScreen session={session} /> },
    { path: '/plans',       element: <PlansScreen session={session} onNewPlan={() => setPlanSheetOpen(true)} onEditPlan={(plan) => { setEditingPlan(plan); setPlanSheetOpen(true) }} refreshKey={planRefreshKey} /> },
    { path: '/daily',       element: <DailyViewScreen session={session} /> },
    { path: '/journal',     element: <JournalScreen session={session} /> },
    { path: '/performance', element: <PerformanceScreen session={session} /> },
    { path: '/ibkr',        element: <IBKRScreen session={session} /> },
    { path: '/settings',    element: <SettingsScreen session={session} /> },
    { path: '/review',      element: <ReviewScreen session={session} /> },
  // PlansScreen receives closures and refreshKey, so it needs to re-key
  // whenever those change. Other screens are stable across renders.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [session, planRefreshKey])

  const knownPaths = useMemo(() => new Set(SCREENS.map(s => s.path)), [SCREENS])
  const [visited, setVisited] = useState(() =>
    knownPaths.has(location.pathname) ? new Set([location.pathname]) : new Set()
  )
  useEffect(() => {
    if (!knownPaths.has(location.pathname)) return
    setVisited(prev => prev.has(location.pathname) ? prev : new Set(prev).add(location.pathname))
  }, [location.pathname, knownPaths])

  return (
    <div className="min-h-screen bg-gray-50">
      <Header onMenuOpen={() => setSidebarOpen(true)} />
      {showDemoBanner && <DemoBanner />}
      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} onSignOut={handleSignOut} session={session} />
      <PlanSheet session={session} isOpen={planSheetOpen} plan={editingPlan} onClose={() => { setPlanSheetOpen(false); setEditingPlan(null) }} onSaved={() => setPlanRefreshKey(k => k + 1)} />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 pb-24 md:pb-6">
        {/* Keep-alive layer: every visited screen stays mounted, only the
            active one is visible. First visit to a screen mounts it lazily;
            subsequent visits are instant with preserved state. */}
        {SCREENS.map(({ path, element }) =>
          !visited.has(path) ? null : (
            <div key={path} style={{ display: location.pathname === path ? 'block' : 'none' }}>
              {element}
            </div>
          )
        )}
        {/* Redirect handling — /signup is the admin invite route and the
            wildcard catches anything else. We only emit a <Navigate> when
            the pathname ISN'T one of our known screens, otherwise we'd
            clobber the keep-alive layer above by rendering a redirect on
            every tick. /signup context: see prior comment — invite link
            from ct3000-admin; logged-out users never hit this (App returns
            AuthScreen directly), only logged-in users who clicked an
            invite and can't redeem without signing out. */}
        <Routes>
          <Route path="/signup" element={<Navigate to="/" replace />} />
          <Route
            path="*"
            element={knownPaths.has(location.pathname) ? null : <Navigate to="/" replace />}
          />
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

  // Maintenance flag — polled from /api/maintenance-status which reads the
  // app_settings row that ct3000-admin's Settings screen writes. Fetched on
  // mount and on window focus so a toggle in admin takes effect within the
  // user's next tab-switch without needing a manual reload.
  //   undefined = still loading, true = app is down, false = normal
  const [maintenance, setMaintenance] = useState(undefined)

  useEffect(() => {
    const check = () => {
      fetch('/api/maintenance-status')
        .then(r => r.json())
        .then(({ active }) => setMaintenance(!!active))
        .catch(() => setMaintenance(false)) // fail open
    }
    check()
    window.addEventListener('focus', check)
    return () => window.removeEventListener('focus', check)
  }, [])

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
    const { data: { subscription: authSub } } = supabase.auth.onAuthStateChange((event, session) => {
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
      // Silent auth events (TOKEN_REFRESHED fires whenever Supabase rotates
      // the access token in the background, e.g. when the tab regains focus
      // after being idle; USER_UPDATED fires on metadata changes). These are
      // not a real session/user change — the same user is still logged in.
      // Bailing out here matters: the block below flips `subscription` to
      // `undefined`, which makes the root gate render <LoadingScreen/> and
      // unmount the entire app tree. That was wiping unsaved form state —
      // e.g. a user typing their IBKR Flex token, switching tabs to IBKR to
      // copy it, coming back and finding the fields empty.
      if (event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') return;
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

  // Public legal pages — accessible without auth so a prospect (or a
  // search engine) can read them before signing up. Checked BEFORE the
  // auth gate so logged-out users get the content instead of the login
  // screen, and logged-in users get it instead of the dashboard.
  // Also checked BEFORE maintenance — legal content is static and
  // shouldn't go dark during app-level maintenance windows.
  if (window.location.pathname === '/terms')          return <TermsScreen />
  if (window.location.pathname === '/privacy')        return <PrivacyScreen />
  // Password-reset completion — routed BEFORE auth/subscription gates so
  // a user arriving from the Supabase recovery email (signed out, or with
  // only a recovery session that shouldn't bounce into the dashboard) can
  // actually set a new password. The screen drives supabase.auth.updateUser
  // itself.
  if (window.location.pathname === '/reset-password') return <ResetPasswordScreen />

  // Maintenance check runs BEFORE auth so a DB-toggled outage gates
  // everything including the login screen. Fail-open happens inside the
  // fetch — if the endpoint errors, `maintenance` becomes false, not true.
  if (maintenance === undefined) return <LoadingScreen />
  if (maintenance) return <MaintenanceScreen />

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
        <PrivacyProvider>
          <BaseCurrencyProvider userId={session.user.id}>
            <DataVersionProvider>
              <AppShell
                session={session}
                subscription={subscription}
                onSubscriptionRefresh={() => fetchSubscription(session.user.id)}
              />
            </DataVersionProvider>
          </BaseCurrencyProvider>
        </PrivacyProvider>
      </ErrorBoundary>
    )
  }

  // No subscription, pending, or canceled
  return <PaywallScreen />
}

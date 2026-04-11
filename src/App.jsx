import React, { useState, useEffect, useCallback } from 'react'
import { supabase } from './lib/supabaseClient'
import { PrivacyProvider } from './lib/PrivacyContext'
import AuthScreen from './components/AuthScreen'
import Header from './components/Header'
import MobileNav from './components/MobileNav'
import Sidebar from './components/Sidebar'
import PlanSheet from './components/PlanSheet'
import ReviewSheet from './components/ReviewSheet'
import PaywallScreen from './screens/PaywallScreen'

import HomeScreen from './screens/HomeScreen'
import PlansScreen from './screens/PlansScreen'
import DailyViewScreen from './screens/DailyViewScreen'
import JournalScreen from './screens/JournalScreen'
import PerformanceScreen from './screens/PerformanceScreen'
import IBKRScreen from './screens/IBKRScreen'
import SettingsScreen from './screens/SettingsScreen'

function AppShell({ session }) {
  const [activeTab, setActiveTab] = useState('home')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [planSheetOpen, setPlanSheetOpen] = useState(false)
  const [reviewSheetOpen, setReviewSheetOpen] = useState(false)
  const [reviewDismissed, setReviewDismissed] = useState(false)
  const [planRefreshKey, setPlanRefreshKey] = useState(0)
  const [editingPlan, setEditingPlan] = useState(null)

  const handleSignOut = async () => {
    await supabase.auth.signOut()
  }

  const renderScreen = () => {
    switch (activeTab) {
      case 'home':   return <HomeScreen session={session} onTabChange={setActiveTab} onReviewOpen={() => setReviewSheetOpen(true)} reviewDismissed={reviewDismissed} />
      case 'plans':  return <PlansScreen session={session} onNewPlan={() => setPlanSheetOpen(true)} onEditPlan={(plan) => { setEditingPlan(plan); setPlanSheetOpen(true); }} refreshKey={planRefreshKey} />
      case 'daily':  return <DailyViewScreen session={session} />
      case 'sj':     return <JournalScreen session={session} />
      case 'perf':   return <PerformanceScreen session={session} />
      case 'ibkr':     return <IBKRScreen session={session} />
      case 'settings': return <SettingsScreen session={session} />
      default:       return <HomeScreen session={session} onTabChange={setActiveTab} onReviewOpen={() => setReviewSheetOpen(true)} reviewDismissed={reviewDismissed} />
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Header
        activeTab={activeTab}
        onTabChange={setActiveTab}
        onMenuOpen={() => setSidebarOpen(true)}
      />

      <Sidebar
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        onTabChange={setActiveTab}
        onSignOut={handleSignOut}
        session={session}
      />

      <PlanSheet
        session={session}
        isOpen={planSheetOpen}
        plan={editingPlan}
        onClose={() => { setPlanSheetOpen(false); setEditingPlan(null); }}
        onSaved={() => setPlanRefreshKey(k => k + 1)}
      />

      <ReviewSheet
        session={session}
        isOpen={reviewSheetOpen}
        onClose={() => setReviewSheetOpen(false)}
        onComplete={() => setReviewDismissed(true)}
      />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 pb-24 md:pb-6">
        {renderScreen()}
      </main>

      <MobileNav activeTab={activeTab} onTabChange={setActiveTab} />
    </div>
  )
}

function isSubscriptionActive(sub) {
  if (!sub) return false;
  const { subscription_status, trial_ends_at, current_period_ends_at } = sub;
  if (subscription_status === 'active') return true;
  if (subscription_status === 'trialing') {
    const endsAt = trial_ends_at || current_period_ends_at;
    return endsAt ? new Date(endsAt) > new Date() : false;
  }
  return false;
}

export default function App() {
  const [session, setSession] = useState(undefined)
  // undefined = loading, null = no subscription / paywall, object = subscription row
  const [subscription, setSubscription] = useState(undefined)

  const checkSubscription = useCallback(async (userId) => {
    const { data, error } = await supabase
      .from('user_subscriptions')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();

    if (error && error.code !== 'PGRST116') {
      console.error('Subscription check error:', error.message);
      setSubscription(null);
      return;
    }

    if (!data) {
      // First login — create a trialing row
      const trialEndsAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
      const { data: newRow } = await supabase
        .from('user_subscriptions')
        .insert({ user_id: userId, subscription_status: 'trialing', trial_ends_at: trialEndsAt })
        .select()
        .single();
      setSubscription(newRow);
    } else {
      setSubscription(data);
    }
  }, [])

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      if (session?.user?.id) checkSubscription(session.user.id)
      else setSubscription(null)
    })

    const { data: { subscription: authSub } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
      if (session?.user?.id) checkSubscription(session.user.id)
      else setSubscription(null)
    })

    return () => authSub.unsubscribe()
  }, [checkSubscription])

  // Re-check subscription on window focus (e.g. after returning from Stripe)
  useEffect(() => {
    const onFocus = () => {
      supabase.auth.getSession().then(({ data: { session } }) => {
        if (session?.user?.id) checkSubscription(session.user.id)
      })
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [checkSubscription])

  // Loading splash
  if (session === undefined || (session && subscription === undefined)) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
            <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
            </svg>
          </div>
          <div className="w-4 h-4 border-2 border-gray-200 border-t-blue-600 rounded-full animate-spin" />
        </div>
      </div>
    )
  }

  if (!session) {
    return <AuthScreen />
  }

  if (!isSubscriptionActive(subscription)) {
    return <PaywallScreen />
  }

  return (
    <PrivacyProvider>
      <AppShell session={session} />
    </PrivacyProvider>
  )
}

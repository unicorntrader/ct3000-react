import React, { useState, useEffect } from 'react'
import { supabase } from './lib/supabaseClient'
import AuthScreen from './components/AuthScreen'
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

function AppShell({ session }) {
  const [activeTab, setActiveTab] = useState('home')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [planSheetOpen, setPlanSheetOpen] = useState(false)
  const [reviewSheetOpen, setReviewSheetOpen] = useState(false)
  const [reviewDismissed, setReviewDismissed] = useState(false)

  const handleSignOut = async () => {
    await supabase.auth.signOut()
  }

  const renderScreen = () => {
    switch (activeTab) {
      case 'home':   return <HomeScreen session={session} onTabChange={setActiveTab} onReviewOpen={() => setReviewSheetOpen(true)} reviewDismissed={reviewDismissed} />
      case 'plans':  return <PlansScreen session={session} onNewPlan={() => setPlanSheetOpen(true)} />
      case 'daily':  return <DailyViewScreen session={session} />
      case 'sj':     return <JournalScreen session={session} />
      case 'perf':   return <PerformanceScreen session={session} />
      case 'ibkr':   return <IBKRScreen session={session} />
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
        isOpen={planSheetOpen}
        onClose={() => setPlanSheetOpen(false)}
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

export default function App() {
  const [session, setSession] = useState(undefined)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
    })

    return () => subscription.unsubscribe()
  }, [])

  // Loading splash
  if (session === undefined) {
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

  return <AppShell session={session} />
}

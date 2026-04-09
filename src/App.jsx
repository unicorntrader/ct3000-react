import React, { useState, useEffect } from 'react'
import { supabase } from './lib/supabaseClient'
import AuthScreen from './components/AuthScreen'

import HomeScreen from './screens/HomeScreen'
import PlansScreen from './screens/PlansScreen'
import DailyViewScreen from './screens/DailyViewScreen'
import JournalScreen from './screens/JournalScreen'
import PerformanceScreen from './screens/PerformanceScreen'
import IBKRScreen from './screens/IBKRScreen'

const NAV_ITEMS = [
  {
    id: 'home', label: 'Home',
    icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />,
  },
  {
    id: 'plans', label: 'Plans',
    icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />,
  },
  {
    id: 'daily', label: 'Daily',
    icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />,
  },
  {
    id: 'journal', label: 'Journal',
    icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />,
  },
  {
    id: 'performance', label: 'Perf',
    icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />,
  },
  {
    id: 'ibkr', label: 'IBKR',
    icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />,
  },
]

function AppShell({ session }) {
  const [activeScreen, setActiveScreen] = useState('home')

  const handleSignOut = async () => {
    await supabase.auth.signOut()
  }

  const renderScreen = () => {
    switch (activeScreen) {
      case 'home':        return <HomeScreen session={session} />
      case 'plans':       return <PlansScreen session={session} />
      case 'daily':       return <DailyViewScreen session={session} />
      case 'journal':     return <JournalScreen session={session} />
      case 'performance': return <PerformanceScreen session={session} />
      case 'ibkr':        return <IBKRScreen session={session} />
      default:            return <HomeScreen session={session} />
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Top bar — matches Header.jsx style */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-14">
            <div className="flex items-center space-x-2">
              <div className="w-7 h-7 bg-blue-600 rounded-lg flex items-center justify-center flex-shrink-0">
                <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                </svg>
              </div>
              <span className="text-lg font-semibold text-gray-900">CT3000</span>
            </div>
            <button
              onClick={handleSignOut}
              className="text-sm text-gray-500 hover:text-gray-800 hover:bg-gray-100 px-3 py-1.5 rounded-lg transition-colors"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      {/* Screen content */}
      <main className="flex-1 overflow-auto pb-20 md:pb-0">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          {renderScreen()}
        </div>
      </main>

      {/* Bottom nav — matches MobileNav.jsx style */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 z-30">
        <div className="flex">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              onClick={() => setActiveScreen(item.id)}
              className={`flex-1 flex flex-col items-center py-2.5 px-1 transition-colors ${
                activeScreen === item.id ? 'text-blue-600' : 'text-gray-400'
              }`}
            >
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center mb-0.5 ${
                activeScreen === item.id ? 'bg-blue-50' : ''
              }`}>
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  {item.icon}
                </svg>
              </div>
              <span className="text-xs font-medium">{item.label}</span>
            </button>
          ))}
        </div>
      </nav>
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
  return (
    <div className="min-h-screen bg-black text-white flex flex-col">
      {/* Top bar */}
      <header className="flex items-center justify-between px-4 py-3 border-b border-zinc-800 bg-zinc-950">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 bg-white flex items-center justify-center">
            <span className="text-black font-black text-xs">CT</span>
          </div>
          <span
            className="text-white font-black text-lg tracking-widest"
            style={{ fontFamily: "'Courier New', monospace" }}
          >
            3000
          </span>
        </div>
        <button
          onClick={handleSignOut}
          className="text-xs text-zinc-500 hover:text-zinc-300 tracking-widest uppercase transition-colors"
        >
          Sign Out
        </button>
      </header>

      {/* Screen content */}
      <main className="flex-1 overflow-auto">
        {renderScreen()}
      </main>

      {/* Bottom nav */}
      <nav className="border-t border-zinc-800 bg-zinc-950 flex">
        {NAV_ITEMS.map((item) => (
          <button
            key={item.id}
            onClick={() => setActiveScreen(item.id)}
            className={`flex-1 flex flex-col items-center justify-center py-3 gap-1 transition-colors ${
              activeScreen === item.id
                ? 'text-white'
                : 'text-zinc-600 hover:text-zinc-400'
            }`}
          >
            <NavIcon icon={item.icon} />
            <span className="text-xs tracking-wider">{item.label}</span>
          </button>
        ))}
      </nav>
    </div>
  )
}

export default function App() {
  const [session, setSession] = useState(undefined) // undefined = loading, null = no session

  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
    })

    // Listen for auth state changes (login, logout, token refresh)
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
    })

    return () => subscription.unsubscribe()
  }, [])

  // Loading splash
  if (session === undefined) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 bg-white flex items-center justify-center">
            <span className="text-black font-black text-sm">CT</span>
          </div>
          <div className="w-4 h-4 border border-zinc-600 border-t-white rounded-full animate-spin" />
        </div>
      </div>
    )
  }

  // Not authenticated → show auth screen
  if (!session) {
    return <AuthScreen />
  }

  // Authenticated → show app
  return <AppShell session={session} />
}

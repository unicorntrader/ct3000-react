import React from 'react'
import { useNavigate } from 'react-router-dom'

// Full-width banner shown to signed-up users who haven't connected IBKR yet.
// Their subscription has demo_seeded=true and ibkr_connected=false — so the
// app is populated with demo rows they can explore, but we surface the path
// to replace that with real data. Auto-disappears when api/sync.js flips
// ibkr_connected=true on first successful sync (and deletes is_demo rows).
export default function DemoBanner() {
  const navigate = useNavigate()
  return (
    <div className="bg-blue-600 text-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3 flex items-center gap-4">
        <div className="w-8 h-8 bg-white/20 rounded-lg flex items-center justify-center shrink-0">
          <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold">You&rsquo;re exploring with demo data.</p>
          <p className="text-xs text-blue-100 mt-0.5 hidden sm:block">
            Connect your IBKR account to replace it with your real trades.
          </p>
        </div>
        <button
          onClick={() => navigate('/ibkr')}
          className="bg-white text-blue-700 text-xs font-semibold px-4 py-1.5 rounded-lg hover:bg-blue-50 shrink-0"
        >
          Connect IBKR →
        </button>
      </div>
    </div>
  )
}

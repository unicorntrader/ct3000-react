import React from 'react'
import { useNavigate } from 'react-router-dom'

export default function DemoBanner() {
  const navigate = useNavigate()
  return (
    <div className="bg-amber-50 border-b border-amber-200 px-4 py-2.5 flex items-center justify-between gap-4">
      <p className="text-xs text-amber-800 font-medium">
        You're viewing demo data — connect your IBKR account to see your real trades.
      </p>
      <button
        onClick={() => navigate('/ibkr')}
        className="flex-shrink-0 text-xs font-semibold text-amber-900 underline underline-offset-2 hover:no-underline"
      >
        Connect IBKR →
      </button>
    </div>
  )
}

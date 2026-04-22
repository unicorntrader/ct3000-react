import React from 'react'

// Rendered at the top of App.jsx when /api/maintenance-status returns
// { active: true }. The admin toggle lives in ct3000-admin's Settings
// screen; flipping it there causes users to land here on their next
// page load or window focus. No auth gate — this screen is intentionally
// reachable by logged-in and logged-out users alike.
export default function MaintenanceScreen() {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="max-w-md text-center">
        <div className="w-12 h-12 bg-blue-600 rounded-xl flex items-center justify-center mx-auto mb-5">
          <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
          </svg>
        </div>
        <h1 className="text-xl font-semibold text-gray-900 mb-2">We'll be right back</h1>
        <p className="text-sm text-gray-600">
          CT3000 is briefly offline for maintenance. Your data is safe — try again in a few minutes.
        </p>
      </div>
    </div>
  )
}

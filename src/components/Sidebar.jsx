import React from 'react';

export default function Sidebar({ isOpen, onClose, onTabChange, onSignOut }) {
  return (
    <>
      <div className={`overlay-bg ${isOpen ? 'open' : ''}`} onClick={onClose} />
      <div className={`slide-right ${isOpen ? 'open' : ''}`}>

        <div className="bg-blue-600 px-5 pt-8 pb-6 relative">
          <button
            onClick={onClose}
            className="absolute top-4 right-4 w-8 h-8 bg-white bg-opacity-20 rounded-lg flex items-center justify-center hover:bg-opacity-30 transition-colors"
          >
            <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>

          <div className="w-14 h-14 bg-white bg-opacity-20 rounded-2xl flex items-center justify-center mb-3">
            <svg className="w-7 h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
          </div>
          <p className="text-white font-semibold text-base">John Trader</p>
          <p className="text-blue-200 text-sm mt-0.5">john@ct3000.app</p>
          <div className="flex items-center space-x-1.5 mt-2">
            <span className="w-2 h-2 rounded-full bg-green-400 inline-block" />
            <span className="text-blue-100 text-xs">IBKR connected · U12345678</span>
          </div>
          <div className="grid grid-cols-2 gap-3 mt-4">
            <div className="bg-white bg-opacity-10 rounded-xl px-3 py-2.5 text-center">
              <p className="text-green-300 text-lg font-semibold">62%</p>
              <p className="text-blue-200 text-xs mt-0.5">Win rate</p>
            </div>
            <div className="bg-white bg-opacity-10 rounded-xl px-3 py-2.5 text-center">
              <p className="text-white text-lg font-semibold">+$970</p>
              <p className="text-blue-200 text-xs mt-0.5">This month</p>
            </div>
          </div>
        </div>

        <div className="px-4 py-5 space-y-5">

          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">IBKR Connection</p>
            <div className="bg-white rounded-xl border border-gray-100">
              <div
                className="px-4 py-3 flex items-center justify-between cursor-pointer hover:bg-gray-50 rounded-xl"
                onClick={() => { onClose(); onTabChange('ibkr'); }}
              >
                <p className="text-sm font-medium text-gray-900">Manage IBKR connection</p>
                <svg className="w-4 h-4 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </div>
            </div>
          </div>

          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Account</p>
            <div className="bg-white rounded-xl border border-gray-100 divide-y divide-gray-50">
              <div className="px-4 py-3 flex items-center justify-between">
                <p className="text-sm font-medium text-gray-900">Account ID</p>
                <p className="text-sm text-gray-400 font-mono">U12345678</p>
              </div>
              <div className="px-4 py-3 flex items-center justify-between">
                <p className="text-sm font-medium text-gray-900">Base currency</p>
                <p className="text-sm text-gray-400">USD</p>
              </div>
              <div className="px-4 py-3 flex items-center justify-between cursor-pointer hover:bg-gray-50">
                <p className="text-sm font-medium text-gray-900">Notifications</p>
                <svg className="w-4 h-4 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </div>
            </div>
          </div>

          <button
            onClick={onSignOut}
            className="w-full bg-white border border-gray-200 text-red-500 font-medium py-3 rounded-xl text-sm hover:bg-red-50 transition-colors"
          >
            Log out
          </button>
        </div>
      </div>
    </>
  );
}

import React from 'react';

const NAV_ITEMS = [
  { id: 'home', label: 'Home' },
  { id: 'plans', label: 'Plans' },
  { id: 'daily', label: 'Daily View' },
  { id: 'sj', label: 'Journal' },
  { id: 'perf', label: 'Performance' },
];

export default function Header({ activeTab, onTabChange, onMenuOpen }) {
  return (
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

          <nav className="hidden md:flex items-center space-x-1 h-full">
            {NAV_ITEMS.map(item => (
              <button
                key={item.id}
                onClick={() => onTabChange(item.id)}
                className={`px-4 h-full text-sm font-medium border-b-2 transition-colors ${
                  activeTab === item.id
                    ? 'text-blue-600 border-blue-600'
                    : 'text-gray-500 border-transparent hover:text-gray-900'
                }`}
              >
                {item.label}
              </button>
            ))}
          </nav>

          <button
            onClick={onMenuOpen}
            className="p-2 text-gray-500 hover:text-gray-800 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
        </div>
      </div>
    </header>
  );
}

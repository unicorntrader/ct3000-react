import React, { useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { supportMailto } from '../lib/constants';

export default function PaywallScreen({ timedOut = false }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleStartTrial = async () => {
    setLoading(true);
    setError(null);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      const res = await fetch('/api/create-checkout-session', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create checkout session');

      window.location.href = data.url;
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="flex flex-col items-center mb-10">
          <div className="w-12 h-12 bg-blue-600 rounded-xl flex items-center justify-center mb-3">
            <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">CT3000</h1>
          <p className="text-sm text-gray-400 mt-1">Your IBKR trading journal</p>
        </div>

        {/* Card */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8">
          {timedOut && (
            <div className="bg-amber-50 border border-amber-100 rounded-xl px-4 py-3 text-sm text-amber-700 mb-4">
              Your payment was received but account activation is taking longer than expected. Try refreshing in a minute, or{' '}
              <a
                href={supportMailto('Account activation stuck after payment')}
                className="underline font-medium hover:text-amber-900"
              >
                email support
              </a>.
            </div>
          )}
          <h2 className="text-xl font-semibold text-gray-900 mb-1">Subscribe to CT3000</h2>
          <p className="text-sm text-gray-500 mb-6">$30/month. Cancel anytime.</p>

          <ul className="space-y-3 mb-8">
            {[
              'Sync trades from IBKR automatically',
              'Track P&L in your base currency',
              'Plan trades with entry, target & stop',
              'Performance analytics & journal',
            ].map(feature => (
              <li key={feature} className="flex items-center gap-3 text-sm text-gray-600">
                <span className="w-5 h-5 rounded-full bg-blue-50 flex items-center justify-center flex-shrink-0">
                  <svg className="w-3 h-3 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                  </svg>
                </span>
                {feature}
              </li>
            ))}
          </ul>

          {error && (
            <p className="text-sm text-red-500 mb-4">{error}</p>
          )}

          <button
            onClick={handleStartTrial}
            disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-xl transition-colors text-sm"
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Redirecting...
              </span>
            ) : (
              'Subscribe now'
            )}
          </button>

          <p className="text-xs text-gray-400 text-center mt-4">
            Cancel anytime from your billing portal.
          </p>
        </div>

        <button
          onClick={() => supabase.auth.signOut()}
          className="w-full mt-4 text-xs text-gray-400 hover:text-gray-600 py-2 transition-colors"
        >
          Sign out
        </button>
      </div>
    </div>
  );
}

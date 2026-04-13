import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabaseClient';

export default function Sidebar({ isOpen, onClose, onSignOut, session }) {
  const navigate = useNavigate();
  const [accountId, setAccountId] = useState(null);
  const [ibkrConnected, setIbkrConnected] = useState(false);

  const email = session?.user?.email || '';
  const name = email.split('@')[0].replace(/[._-]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

  useEffect(() => {
    if (!session?.user?.id) return;
    supabase
      .from('user_ibkr_credentials')
      .select('account_id, ibkr_token')
      .eq('user_id', session.user.id)
      .single()
      .then(({ data, error }) => {
        if (error && error.code !== 'PGRST116') {
          console.error('Sidebar: failed to load IBKR credentials:', error.message);
          return;
        }
        if (data?.ibkr_token) setIbkrConnected(true);
        if (data?.account_id) setAccountId(data.account_id);
      });
  }, [session]);

  return (
    <>
      <div className={`overlay-bg ${isOpen ? 'open' : ''}`} onClick={onClose} />
      <div className={`slide-right ${isOpen ? 'open' : ''}`}>

        {/* Profile header */}
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
            <span className="text-white text-xl font-semibold">
              {name.charAt(0).toUpperCase()}
            </span>
          </div>
          <p className="text-white font-semibold text-base">{name}</p>
          <p className="text-blue-200 text-sm mt-0.5">{email}</p>
          <div className="flex items-center space-x-1.5 mt-2">
            <span className={`w-2 h-2 rounded-full inline-block ${ibkrConnected ? 'bg-green-400' : 'bg-gray-300'}`} />
            <span className="text-blue-100 text-xs">
              {ibkrConnected
                ? `IBKR connected${accountId ? ` · ${accountId}` : ''}`
                : 'IBKR not connected'}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-3 mt-4">
            <div className="bg-white bg-opacity-10 rounded-xl px-3 py-2.5 text-center">
              <p className="text-green-300 text-lg font-semibold">--</p>
              <p className="text-blue-200 text-xs mt-0.5">Win rate</p>
            </div>
            <div className="bg-white bg-opacity-10 rounded-xl px-3 py-2.5 text-center">
              <p className="text-white text-lg font-semibold">--</p>
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
                onClick={() => { onClose(); navigate('/ibkr'); }}
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
                <p className="text-sm text-gray-400 font-mono">{accountId || '—'}</p>
              </div>
              <div className="px-4 py-3 flex items-center justify-between">
                <p className="text-sm font-medium text-gray-900">Email</p>
                <p className="text-sm text-gray-400 truncate max-w-36">{email}</p>
              </div>
              <div
                className="px-4 py-3 flex items-center justify-between cursor-pointer hover:bg-gray-50 rounded-b-xl"
                onClick={() => { onClose(); navigate('/settings'); }}
              >
                <p className="text-sm font-medium text-gray-900">Settings</p>
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

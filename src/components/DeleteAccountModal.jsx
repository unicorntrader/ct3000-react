import React, { useState, useEffect } from 'react';
import * as Sentry from '@sentry/react';
import { supabase } from '../lib/supabaseClient';

/**
 * Account deletion modal with a two-step gate.
 *
 * Step 1 — Subscription check. If the user has an active or trialing
 *          Stripe subscription, we block the deletion and send them to
 *          the billing portal to cancel first. Prevents the worst failure
 *          mode: deleting the account while Stripe keeps billing the card.
 *
 * Step 2 — Feedback + type-to-confirm. Two free-text prompts
 *          ("What didn't work?", "What would you like to see change?")
 *          and a DELETE type-in confirmation gate the destructive button.
 *          Feedback is optional, typing DELETE is not — prevents
 *          click-through accidents.
 *
 * On successful deletion we sign the user out client-side. The server
 * already revoked their session, but signOut() clears the local tokens
 * too so the next render flips to AuthScreen.
 */

function BillingPortalBlocker({ onClose }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const openPortal = async () => {
    setLoading(true);
    setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');
      const res = await fetch('/api/billing-portal', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${session.access_token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not open billing portal');
      window.location.href = data.url;
    } catch (err) {
      Sentry.withScope((scope) => {
        scope.setTag('component', 'DeleteAccountModal');
        scope.setTag('step', 'billing-portal');
        Sentry.captureException(err instanceof Error ? err : new Error(String(err)));
      });
      setError(err.message);
      setLoading(false);
    }
  };

  return (
    <>
      <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 mb-4">
        <p className="text-sm text-amber-800 font-medium mb-1">
          Cancel your subscription first
        </p>
        <p className="text-xs text-amber-700 leading-relaxed">
          Your account has an active subscription. If we delete the account while
          billing is active, your card keeps getting charged with no way to stop
          it. Cancel in the billing portal, then come back here.
        </p>
      </div>
      {error && (
        <div className="bg-red-50 border border-red-100 rounded-xl px-4 py-3 text-xs text-red-700 mb-4">
          {error}
        </div>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onClose}
          className="flex-1 border border-gray-200 text-gray-700 font-medium py-3 rounded-xl text-sm hover:bg-gray-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={openPortal}
          disabled={loading}
          className="flex-1 bg-blue-600 text-white font-semibold py-3 rounded-xl text-sm hover:bg-blue-700 disabled:opacity-60 flex items-center justify-center gap-2"
        >
          {loading && <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
          Go to billing portal
        </button>
      </div>
    </>
  );
}

function DeleteForm({ onClose, onDeleted }) {
  const [whatDidntWork, setWhatDidntWork] = useState('');
  const [whatWouldYouChange, setWhatWouldYouChange] = useState('');
  const [confirmText, setConfirmText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const canDelete = confirmText.trim().toUpperCase() === 'DELETE';

  const handleDelete = async () => {
    if (!canDelete) return;
    setSubmitting(true);
    setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');
      const res = await fetch('/api/delete-account', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          what_didnt_work: whatDidntWork.trim() || null,
          what_would_you_change: whatWouldYouChange.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Deletion failed');
      // Sign out locally too — server already revoked the session.
      await supabase.auth.signOut();
      onDeleted();
    } catch (err) {
      Sentry.withScope((scope) => {
        scope.setTag('component', 'DeleteAccountModal');
        scope.setTag('step', 'submit');
        Sentry.captureException(err instanceof Error ? err : new Error(String(err)));
      });
      setError(err.message);
      setSubmitting(false);
    }
  };

  return (
    <>
      <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 mb-4">
        <p className="text-sm text-red-800 font-medium mb-1">
          This cannot be undone
        </p>
        <p className="text-xs text-red-700 leading-relaxed">
          All your trades, plans, notes, and connection data will be permanently
          deleted. We can't recover them once this is done.
        </p>
      </div>

      <div className="space-y-4 mb-4">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1.5">
            What didn't work for you? <span className="text-gray-400 font-normal">(optional)</span>
          </label>
          <textarea
            value={whatDidntWork}
            onChange={e => setWhatDidntWork(e.target.value)}
            rows={3}
            placeholder="Anything — a missing feature, a bug, something that felt wrong…"
            className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400 resize-none"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1.5">
            What would you like to see change? <span className="text-gray-400 font-normal">(optional)</span>
          </label>
          <textarea
            value={whatWouldYouChange}
            onChange={e => setWhatWouldYouChange(e.target.value)}
            rows={3}
            placeholder="If we fixed X you'd come back. X is…"
            className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400 resize-none"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1.5">
            Type <span className="font-mono font-semibold text-red-600">DELETE</span> to confirm
          </label>
          <input
            type="text"
            value={confirmText}
            onChange={e => setConfirmText(e.target.value)}
            placeholder="DELETE"
            className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-red-400 font-mono tracking-wider"
            autoComplete="off"
          />
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-100 rounded-xl px-4 py-3 text-xs text-red-700 mb-4">
          {error}
        </div>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={onClose}
          disabled={submitting}
          className="flex-1 border border-gray-200 text-gray-700 font-medium py-3 rounded-xl text-sm hover:bg-gray-50 disabled:opacity-60"
        >
          Keep my account
        </button>
        <button
          type="button"
          onClick={handleDelete}
          disabled={!canDelete || submitting}
          className="flex-1 bg-red-600 text-white font-semibold py-3 rounded-xl text-sm hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          {submitting && <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
          {submitting ? 'Deleting…' : 'Delete my account'}
        </button>
      </div>
    </>
  );
}

export default function DeleteAccountModal({ session, isOpen, onClose, onDeleted }) {
  const [subStatus, setSubStatus] = useState(undefined); // undefined while loading
  const [loading, setLoading] = useState(true);

  // Check billing status on open so the modal decides which pane to show.
  // We re-check every open in case the user just cancelled via the portal
  // and came back — stale state on the way in would misleadingly block them.
  useEffect(() => {
    if (!isOpen || !session?.user?.id) return;
    setLoading(true);
    (async () => {
      try {
        const { data } = await supabase
          .from('user_subscriptions')
          .select('subscription_status, is_comped')
          .eq('user_id', session.user.id)
          .maybeSingle();
        const active = data
          && !data.is_comped
          && (data.subscription_status === 'active' || data.subscription_status === 'trialing');
        setSubStatus(active ? 'blocked' : 'ok');
      } catch (err) {
        // On error, fall through to the delete form and let the server
        // re-check. Better UX than a hard block on a transient DB error.
        Sentry.withScope((scope) => {
          scope.setTag('component', 'DeleteAccountModal');
          scope.setTag('step', 'sub-check');
          Sentry.captureException(err instanceof Error ? err : new Error(String(err)));
        });
        setSubStatus('ok');
      } finally {
        setLoading(false);
      }
    })();
  }, [isOpen, session?.user?.id]);

  // Close on Esc
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-gray-900">Delete account</h3>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg hover:bg-gray-100 flex items-center justify-center text-gray-400 hover:text-gray-600"
            aria-label="Close"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="p-5">
          {loading || subStatus === undefined ? (
            <div className="flex items-center justify-center py-8">
              <div className="w-5 h-5 border-2 border-gray-200 border-t-blue-600 rounded-full animate-spin" />
            </div>
          ) : subStatus === 'blocked' ? (
            <BillingPortalBlocker onClose={onClose} />
          ) : (
            <DeleteForm onClose={onClose} onDeleted={onDeleted} />
          )}
        </div>
      </div>
    </div>
  );
}

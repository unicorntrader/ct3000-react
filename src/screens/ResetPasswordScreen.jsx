import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabaseClient';

// Completion step of the password-reset flow.
//
// Entry point: AuthScreen's "Forgot password?" form calls
//   supabase.auth.resetPasswordForEmail(email, { redirectTo: `${origin}/reset-password` })
// Supabase emails the user a link containing a recovery token in the URL
// hash (#access_token=...&type=recovery). When the link is clicked,
// supabase-js picks the hash up on page load, exchanges it for a session,
// and fires a PASSWORD_RECOVERY auth event. That session is what lets us
// call auth.updateUser({ password }) here.
//
// States handled:
//   - hash is present but supabase-js hasn't processed it yet  → loading
//   - recovery session established                             → show form
//   - no recovery session and no hash  (user typed URL in)     → error +
//                                                                back-to-login
//   - update succeeded                                         → success +
//                                                                auto-redirect
//   - update failed                                            → inline error
//
// Password policy mirrors AuthScreen handleSignup / handleInviteSignup so
// a user's reset password can't be weaker than their original.

function validatePassword(pw) {
  if (pw.length < 8) return 'Password must be at least 8 characters.';
  if (!/[0-9]/.test(pw)) return 'Password must contain at least one number.';
  if (!/[A-Z]/.test(pw) && !/[!@#$%^&*]/.test(pw)) {
    return 'Password must contain at least one uppercase letter or special character (!@#$%^&*).';
  }
  return null;
}

function Logo() {
  return (
    <div className="flex items-center gap-2.5">
      <div className="w-9 h-9 bg-blue-600 rounded-xl flex items-center justify-center flex-shrink-0">
        <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
        </svg>
      </div>
      <span className="text-xl font-bold text-gray-900">CT3000</span>
    </div>
  );
}

export default function ResetPasswordScreen() {
  const navigate = useNavigate();

  // 'checking' | 'ready' | 'invalid' | 'saving' | 'success' | 'error'
  const [status, setStatus] = useState('checking');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState(null);

  // On mount: wait for supabase-js to process the hash. If a recovery
  // session shows up, we're good. If after a short grace we still have
  // no session AND no recovery hash, the user probably typed this URL in
  // directly -- show an invalid-link state with a link back to login.
  useEffect(() => {
    let cancelled = false;

    const hash = window.location.hash || '';
    const hasRecoveryHash = hash.includes('type=recovery') || hash.includes('access_token=');

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (cancelled) return;
      if (event === 'PASSWORD_RECOVERY') {
        setStatus('ready');
      }
    });

    // Fallback: supabase-js may have already processed the hash before
    // we subscribed. Check for an existing session too.
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (cancelled) return;
      if (session) {
        setStatus('ready');
        return;
      }
      // Give supabase-js ~1.5s to finish processing a hash-based session,
      // then declare the link invalid. This is purely a UX thing; without
      // it the user stares at a spinner forever on a malformed URL.
      if (!hasRecoveryHash) {
        setStatus('invalid');
        return;
      }
      setTimeout(async () => {
        if (cancelled) return;
        const { data: { session: laterSession } } = await supabase.auth.getSession();
        if (!laterSession) setStatus('invalid');
      }, 1500);
    })();

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    const policyError = validatePassword(password);
    if (policyError) { setError(policyError); return; }
    if (password !== confirm) { setError('Passwords do not match.'); return; }

    setStatus('saving');
    const { error: updateError } = await supabase.auth.updateUser({ password });
    if (updateError) {
      setError(updateError.message);
      setStatus('ready');
      return;
    }
    setStatus('success');
    // Brief confirmation, then return to a signed-in state. App.jsx will
    // pick up the session and route appropriately (dashboard or paywall).
    setTimeout(() => navigate('/'), 1500);
  };

  const inputClass = "w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-gray-50 text-gray-900 placeholder-gray-300";
  const labelClass = "block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5";

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="flex justify-center mb-6"><Logo /></div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8">
          <h1 className="text-lg font-semibold text-gray-900 mb-1">Set a new password</h1>

          {status === 'checking' && (
            <div className="py-8 text-center">
              <div className="w-5 h-5 border-2 border-gray-200 border-t-blue-600 rounded-full animate-spin mx-auto" />
              <p className="text-xs text-gray-400 mt-3">Verifying reset link…</p>
            </div>
          )}

          {status === 'invalid' && (
            <>
              <p className="text-sm text-gray-600 mt-2 mb-4">
                This reset link is invalid or has expired. Request a new one from the login screen.
              </p>
              <Link to="/" className="inline-flex items-center justify-center w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3.5 rounded-xl text-sm transition-colors">
                Back to login
              </Link>
            </>
          )}

          {(status === 'ready' || status === 'saving') && (
            <>
              <p className="text-sm text-gray-500 mt-1 mb-5">
                Choose a new password for your CT3000 account.
              </p>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className={labelClass}>New password</label>
                  <input
                    type="password"
                    autoComplete="new-password"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    className={inputClass}
                    placeholder="At least 8 characters"
                    disabled={status === 'saving'}
                    autoFocus
                  />
                </div>
                <div>
                  <label className={labelClass}>Confirm new password</label>
                  <input
                    type="password"
                    autoComplete="new-password"
                    value={confirm}
                    onChange={e => setConfirm(e.target.value)}
                    className={inputClass}
                    placeholder="Re-enter new password"
                    disabled={status === 'saving'}
                  />
                </div>
                {error && (
                  <div className="bg-red-50 border border-red-100 rounded-xl px-4 py-3 text-sm text-red-600">
                    {error}
                  </div>
                )}
                <button
                  type="submit"
                  disabled={status === 'saving'}
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3.5 rounded-xl text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {status === 'saving' ? 'Saving…' : 'Update password'}
                </button>
              </form>
            </>
          )}

          {status === 'success' && (
            <div className="py-6 text-center">
              <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-3">
                <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <p className="text-sm font-semibold text-gray-900">Password updated</p>
              <p className="text-xs text-gray-400 mt-1">Redirecting you to the app…</p>
            </div>
          )}
        </div>

        <p className="text-center text-[11px] text-gray-400 mt-6">
          <Link to="/terms" className="hover:text-gray-600 transition-colors">Terms</Link>
          <span className="mx-2 text-gray-200">·</span>
          <Link to="/privacy" className="hover:text-gray-600 transition-colors">Privacy</Link>
        </p>
      </div>
    </div>
  );
}

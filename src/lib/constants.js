/**
 * App-wide constants.
 *
 * Keep this file tiny and string-heavy. Things like support email, legal
 * contact, version stamp — stuff that appears in the UI and in outbound
 * messages, and that we might need to swap in a single place.
 */

// ─── Support ───────────────────────────────────────────────────────────────

/**
 * Published support email. Shown to users wherever they might need help —
 * paywall errors, sync failures, Settings screen, footers.
 *
 * TODO: SWAP TO 'support@cotraderapp.com' once that mailbox + ticket service
 * is live. The domain is owned; only the inbox needs wiring. When you flip
 * this, also update src/screens/SettingsScreen.jsx if it hard-codes the
 * string (it shouldn't — imports from here).
 */
export const SUPPORT_EMAIL = 'thinker@philoinvestor.com';

/**
 * Build a mailto: URL with prefilled subject (and optional body). Subject
 * defaults to "CT3000 support" — customise per call site for bug reports,
 * billing queries, etc. so the ticket queue is pre-triaged.
 */
export const supportMailto = (subject = 'CT3000 support', body = '') => {
  const params = new URLSearchParams();
  if (subject) params.set('subject', subject);
  if (body) params.set('body', body);
  const qs = params.toString();
  return `mailto:${SUPPORT_EMAIL}${qs ? '?' + qs : ''}`;
};

// ─── App version ───────────────────────────────────────────────────────────

/**
 * Semver-ish version stamp shown in Settings and sidebar footer. Bumped
 * manually with meaningful releases. Beta users pasting "v0.9.2-beta" into
 * a support email makes triage trivial.
 *
 * Bump on:
 *   - major   — breaking data-model changes
 *   - minor   — user-visible feature additions (TradeSquares launch, etc.)
 *   - patch   — bug fixes / polish
 */
export const APP_VERSION = '0.9.0-beta';

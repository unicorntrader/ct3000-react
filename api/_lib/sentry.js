// Thin Sentry wrapper for Vercel serverless functions.
//
// Usage in any api/* handler:
//   const { captureServerError } = require('./_lib/sentry');
//   ...
//   try { ... } catch (err) {
//     await captureServerError(err, { userId, step: 'flex-fetch', route: 'sync' });
//     return res.status(500).json({ error: err.message });
//   }
//
// No-op if SENTRY_DSN is unset (we still want local/preview deploys to work
// without a Sentry project). Init is guarded so multiple imports in a single
// function invocation don't double-register.

const Sentry = require('@sentry/node');

let initialized = false;

function ensureInit() {
  if (initialized) return;
  initialized = true; // set early so a failed init doesn't retry on every call
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;
  Sentry.init({
    dsn,
    environment: process.env.VERCEL_ENV || process.env.NODE_ENV || 'development',
    // Low traces rate keeps us well within the free tier while still giving
    // us a sense of sync performance over time.
    tracesSampleRate: 0.1,
    // Don't auto-collect IP addresses; the user_id tag is enough for us to
    // correlate tickets with Supabase users, and it keeps us out of PII land.
    sendDefaultPii: false,
  });
}

// Wrap a possibly-non-Error value into an Error, preserving useful fields
// from Supabase error objects (they're plain {message,code,hint,details}
// objects, not Error instances -- `String(err)` on them returns the
// useless "[object Object]").
function toError(err) {
  if (err instanceof Error) return err;
  if (err && typeof err === 'object') {
    const msg = err.message
      || err.error_description
      || err.error
      || `Non-Error object: ${JSON.stringify(err).slice(0, 500)}`;
    const wrapped = new Error(msg);
    if (err.code)    wrapped.code = err.code;
    if (err.hint)    wrapped.hint = err.hint;
    if (err.details) wrapped.details = err.details;
    if (err.stack)   wrapped.stack = err.stack;
    return wrapped;
  }
  return new Error(String(err));
}

// Capture an error with standardized tags/context and flush before the
// serverless sandbox freezes. Flush timeout is short so a slow Sentry ingest
// doesn't hang the API response for the user.
async function captureServerError(err, { userId, step, route } = {}) {
  ensureInit();
  try {
    Sentry.withScope((scope) => {
      if (route) scope.setTag('route', route);
      if (step) scope.setTag('sync_step', step);
      if (userId) scope.setUser({ id: userId });
      // Attach the raw error fields as a context block -- viewable in the
      // Sentry event under "Additional Data". Keeps all the Supabase details
      // (code, hint, details) visible even though the exception title is
      // just the message.
      if (err && typeof err === 'object' && !(err instanceof Error)) {
        scope.setContext('raw_error', {
          message:  err.message,
          code:     err.code,
          hint:     err.hint,
          details:  err.details,
          status:   err.status,
          name:     err.name,
        });
      }
      Sentry.captureException(toError(err));
    });
    await Sentry.flush(2000);
  } catch (sentryErr) {
    // If Sentry itself fails, we don't want to take down the handler.
    console.error('[sentry] capture failed:', sentryErr?.message || sentryErr);
  }
}

module.exports = { captureServerError };

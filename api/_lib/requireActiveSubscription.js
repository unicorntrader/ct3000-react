// Server-side paywall gate. Matches the isActive() logic in src/App.jsx so
// the UI and the API agree on who's paid. Used by sync, rebuild, and the
// nightly cron so an expired trial / canceled subscription can't keep
// burning IBKR quota + our compute just by still holding a valid JWT.
//
// Returns { ok: true } if the user is active / trialing (not expired) /
// comped. Returns { ok: false, reason } otherwise. Callers turn reason
// into a 402 response body.

async function requireActiveSubscription(userId, supabaseAdmin) {
  const { data: sub, error } = await supabaseAdmin
    .from('user_subscriptions')
    .select('subscription_status, trial_ends_at, current_period_ends_at, is_comped')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    // Failing closed: DB error at auth time is indistinguishable from
    // "you don't have a subscription", and we'd rather block than bill.
    return { ok: false, reason: 'Could not verify subscription status.' };
  }
  if (!sub) {
    return { ok: false, reason: 'No subscription on file.' };
  }
  if (sub.is_comped) return { ok: true };
  if (sub.subscription_status === 'active') return { ok: true };
  if (sub.subscription_status === 'trialing') {
    const endsAt = sub.trial_ends_at || sub.current_period_ends_at;
    if (!endsAt) return { ok: true };           // brand-new trial, dates not set yet
    if (new Date(endsAt) > new Date()) return { ok: true };
    return { ok: false, reason: 'Your trial has ended. Please subscribe to continue.' };
  }
  return { ok: false, reason: 'Your subscription is not active. Please resubscribe to continue.' };
}

module.exports = { requireActiveSubscription };

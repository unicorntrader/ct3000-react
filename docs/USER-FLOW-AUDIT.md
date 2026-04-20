# User-flow audit — CT3000

Last reviewed 2026-04-20 after the anonymous-demo ("Try demo") flow was retired.

**Scope:** every possible state a user can be in, every way they enter the app, every transition between states.

**TL;DR:** 4 entry paths, no dead code, no banner conflicts, no wedged states. The anonymous flow was removed because signed-up trial users already get populated demo data on first login (variant D / auto-seed) — the two paths were redundant, and the anon path carried more surface area.

---

## 1. User states

| State | How to detect | What they see | Can sync IBKR? |
|---|---|---|---|
| **Logged out** | `session === null` | `AuthScreen` (landing / signup / login / reset / invite modes) | No |
| **Still loading** | `session === undefined` OR `session && subscription === undefined` | `LoadingScreen` (spinner) | No |
| **Signed-up, polling for Stripe** | `?checkout=success` in URL, no active subscription yet | `LoadingScreen` "Welcome! Setting up your account…" (30s timeout) | No (still in Stripe loop) |
| **Signed-up, Stripe timeout** | Polling exceeded 15 × 2s without seeing an active subscription | `PaywallScreen` with `timedOut` banner | No |
| **Signed-up, trialing** | `subscription.subscription_status === 'trialing'` AND `trial_ends_at > now` (or unset) | `AppShell`. `DemoBanner` at top if `demo_seeded && !ibkr_connected`. | Yes |
| **Signed-up, active** | `subscription.subscription_status === 'active'` | Same as trialing — `AppShell` + maybe `DemoBanner` | Yes |
| **Comped (invited)** | `is_comped === true`, created by `api/redeem-invite.js` with `subscription_status='active'` | Same as active. Webhook skips any future updates (see `stripe-webhook.js` lines 85-93). | Yes |
| **Canceled / paywalled** | Not `isActive(subscription)` — anything that isn't `active` or a valid `trialing` | `PaywallScreen` (subscribe CTA) | No |

---

## 2. Entry paths (4 doors)

### Door 1 — Landing → free trial signup
`AuthScreen.handleSignup` → `supabase.auth.signUp` → `createCheckoutSession` → redirect to Stripe → Stripe webhook (`checkout.session.completed`) upserts `user_subscriptions` with `trialing` status → user returns with `?checkout=success` → App.jsx polls until active → `AppShell` mounts → peek sees `!demo_seeded && !ibkr_connected` → seeds demo → banner shows.

### Door 2 — Login (returning user)
`AuthScreen.handleLogin` → `supabase.auth.signInWithPassword` → App.jsx fetches subscription → depending on status, lands on `AppShell` or `PaywallScreen`. No seeding re-runs because `demo_seeded` is already true.

### Door 3 — Invite link (`?invite=TOKEN`)
Admin creates an `invited_users` row with a token → user clicks link → `AuthScreen` reads token from URL → `handleInviteSignup` → `/api/redeem-invite` creates auth user + `user_subscriptions` row (`subscription_status='active'`, `is_comped=true`, `demo_seeded=false`) → redeemer signs in → App.jsx peeks → seeds demo → banner shows.

### Door 4 — Password reset
`AuthScreen.handleReset` → `supabase.auth.resetPasswordForEmail` → Supabase sends magic link with `redirectTo=/reset-password`. **The app has no `/reset-password` route.** The wildcard catch sends them home. Supabase's JS client does auto-consume the hash tokens, so the session is typically established, but there's no custom UI to actually set a new password. **Known gap, documented in SETUP.md.**

---

## 3. State transitions

| From | To | Triggered by | What updates |
|---|---|---|---|
| Logged out | Trialing | Signup form | Stripe checkout flow + webhook |
| Logged out | Active + comped | Invite link | `/api/redeem-invite` creates auth user + subscription row |
| Trialing | Active | Stripe's trial-end event | `stripe-webhook.js:customer.subscription.updated` path |
| Active | Canceled | Stripe cancellation | `stripe-webhook.js:customer.subscription.deleted` sets `subscription_status='canceled'` |
| Any | Logged out | Sign out button | `supabase.auth.signOut()` |

---

## 4. Known gaps

### `/reset-password` has no landing route
See SETUP.md "Known gaps." Supabase handles the auth hash automatically but there's no custom UI to set a new password. User gets logged in and has to navigate to settings manually (where there's also no change-password UI). Worth fixing before broad public launch.

### Window-focus refetch is aggressive
`App.jsx` re-fetches `user_subscriptions` every time the tab regains focus. Small DB hit; no user impact. Could be debounced or scoped to when the tab has been backgrounded for more than N minutes.

---

## 5. Edge cases (sanity-checked)

- **User closes tab during Stripe webhook** → returns with no `?checkout=success`. Auth effect fetches subscription → if webhook already fired, shows AppShell. If not, shows PaywallScreen. User can click Subscribe from there to retry checkout — `createCheckoutSession` is idempotent on `stripe_customer_id`.
- **Comped user connects IBKR and syncs** → webhook skips subscription updates for comped users; sync.js still writes `ibkr_connected=true`. Works correctly.
- **Canceled user reactivates** → Stripe would send a new `checkout.session.completed`, webhook upserts subscription back to active. Works.
- **User disconnects IBKR** (`IBKRScreen.handleRemove`) → deletes the credentials row AND resets `ibkr_connected=false`, so the DemoBanner reappears as a path back if they have demo data. Fixed 2026-04-20.

---

## 6. What's confirmed clean

- No dead code paths after the anonymous-flow removal (full grep clean for `anonymous`, `is_anonymous`, `AnonymousBanner`, `anonReady`, `signInAnonymously`, `has_seen_welcome` in `src/` and `api/`).
- No banner overlap bugs — only one banner can render (`DemoBanner`, gated on `demo_seeded && !ibkr_connected`).
- No wedged states — every code path resolves to AppShell, Paywall, AuthScreen, or LoadingScreen.
- Security / RLS — clean, per `docs/CODE-AUDIT.md` finding #2.

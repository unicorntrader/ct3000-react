# User-flow audit — CT3000

Generated 2026-04-20 after the WelcomeModal → DemoBanner + auto-seed refactor.

**Scope:** every possible state a user can be in, every way they enter the app, every transition between states, and everything that looks dead or confused in those paths.

**TL;DR:** 3 real bugs (all pre-beta fixable in <30 min each), 1 dead DB flag, a couple of low-priority housekeeping items. No security gaps. The auto-seed refactor works correctly for the main flows.

---

## 1. User states

Every distinct state a logged-in-or-not user can occupy, and what defines it. Column ordering: what the user sees in the app is a direct function of these.

| State | How to detect (code/DB) | What they see | Can they sync IBKR? |
|---|---|---|---|
| **Logged out** | `session === null` | `AuthScreen` (landing / signup / login / reset / invite modes) | No |
| **Still loading** | `session === undefined` OR `session && subscription === undefined` | `LoadingScreen` (spinner) | No |
| **Anonymous** | `session.user.is_anonymous === true` | `AppShell` with `AnonymousBanner` at top, demo data populated. Subscription is forced to `null`. | No — `api/sync.js` rejects anonymous users at line 201 |
| **Signed-up, polling for Stripe** | Has `?checkout=success` in URL AND no active subscription yet | `LoadingScreen` "Welcome! Setting up your account…" (30s timeout) | No (still in Stripe loop) |
| **Signed-up, Stripe timeout** | Polling exceeded 15 × 2s without seeing an active subscription | `PaywallScreen` with `timedOut` banner | No |
| **Signed-up, trialing** | `subscription.subscription_status === 'trialing'` AND `trial_ends_at > now` (or unset) | `AppShell`. `DemoBanner` at top if `demo_seeded && !ibkr_connected`. | Yes |
| **Signed-up, active** | `subscription.subscription_status === 'active'` | Same as trialing — `AppShell` + maybe `DemoBanner` | Yes |
| **Comped (invited)** | `is_comped === true`, set by `api/redeem-invite.js` with `subscription_status='active'` | Same as active. Webhook skips any future updates (see `stripe-webhook.js` lines 85-93). | Yes |
| **Canceled / paywalled** | Not `isActive(subscription)` — anything that isn't `active` or a valid `trialing` | `PaywallScreen` (subscribe CTA) | No |

---

## 2. Entry flows

All the ways a user crosses the threshold into a session.

### Landing → free trial signup
`AuthScreen.handleSignup` → `supabase.auth.signUp` → `createCheckoutSession` → redirect to Stripe → Stripe webhook (`checkout.session.completed`) upserts `user_subscriptions` with `trialing` status → user returns with `?checkout=success` → App.jsx polls until active → `AppShell` mounts → peek sees `!demo_seeded && !ibkr_connected` → seeds demo → banner shows.

### Landing → "Try demo"
`AuthScreen.handleTryDemo` → `supabase.auth.signInAnonymously` → App.jsx's auth effect sees `is_anonymous` → `seedDemoData(session).finally(() => setAnonReady(true))` → `AnonymousBanner` (48h warning) + populated `AppShell`.

### Login (returning user)
`AuthScreen.handleLogin` → `supabase.auth.signInWithPassword` → App.jsx fetches subscription → depending on status, lands on `AppShell` or `PaywallScreen`. No seeding re-runs because `demo_seeded` is already true.

### Invite link (`?invite=TOKEN`)
Admin creates an `invited_users` row with a token → user clicks link → `AuthScreen` reads token from URL → `handleInviteSignup` → `/api/redeem-invite` creates auth user + `user_subscriptions` row (`subscription_status='active'`, `is_comped=true`, demo_seeded false) → redeemer signs in → App.jsx peeks → seeds demo → banner shows.

### Anonymous → real user ("Sign up free" in banner)
`AnonymousBanner.handleConvert` → `supabase.auth.updateUser({ email, password })` (preserves `user.id`) → new session on same id → `createCheckoutSession` → Stripe → webhook creates `user_subscriptions` row → return with `?checkout=success` → poll → AppShell. **See bug #1 below.**

### Password reset
`AuthScreen.handleReset` → `supabase.auth.resetPasswordForEmail` → Supabase sends magic link with `redirectTo=/reset-password`. **The app has no `/reset-password` route.** The wildcard catch sends them home. Supabase's JS client does auto-consume the hash tokens, so the session is typically established, but the user has no way to actually set a new password. **Known gap, documented in SETUP.md.**

---

## 3. State transitions

| From | To | Triggered by | What updates |
|---|---|---|---|
| Logged out | Anonymous | "Try demo" button | `signInAnonymously` → auth user created → App seeds demo |
| Logged out | Trialing | Signup form | Stripe checkout flow + webhook |
| Anonymous | Trialing | `AnonymousBanner` convert form | `auth.updateUser` keeps user.id → Stripe checkout → webhook upserts subscription |
| Logged out | Active + comped | Invite link | `/api/redeem-invite` creates auth user + subscription row |
| Trialing | Active | Stripe's trial-end event | `stripe-webhook.js:customer.subscription.updated` path |
| Active | Canceled | Stripe cancellation | `stripe-webhook.js:customer.subscription.deleted` sets `subscription_status='canceled'` |
| Any | Logged out | Sign out button | `supabase.auth.signOut()` |

---

## 4. Bugs found

### #1 — Converted anon users never see the DemoBanner **[HIGH — blocking for beta]**
**Path:** anon user → Sign up free → Stripe → returns to app.
**Problem:** `api/seed-demo.js` checks for existing is-demo planned_trades and short-circuits with `already_seeded: true` (line 34). The short-circuit path does NOT flip `user_subscriptions.demo_seeded = true` — that's at line 178, below the early return. So the converted user still has their anon demo data, but `demo_seeded` stays false. The banner condition `demo_seeded && !ibkr_connected` fails → no banner → user has demo data but no prompt to connect IBKR.
**Fix:** before `return res.status(200).json({ already_seeded: true })`, also update `user_subscriptions` with `demo_seeded=true` when user is NOT anonymous.
**Size:** 3 lines.

### #2 — Removing IBKR credentials doesn't reset `ibkr_connected` **[MEDIUM]**
**Path:** user goes to IBKR screen → "Remove" button.
**Problem:** `IBKRScreen.handleRemove` (line 109) deletes the `user_ibkr_credentials` row but doesn't update `user_subscriptions.ibkr_connected = false`. So the flag stays stale. User has no credentials, no sync possible, but the DemoBanner condition (`!ibkr_connected`) hides the banner. They're stuck with no data and no visible CTA to re-connect.
**Fix:** add an `update({ ibkr_connected: false })` call in handleRemove, alongside the credentials delete.
**Size:** 5 lines.

### #3 — `has_seen_welcome` is a dead flag **[LOW / cleanup]**
**Where written:** `api/seed-demo.js:178` — sets `has_seen_welcome=true` on successful seed.
**Where read:** **nowhere in the current codebase.** Originally read by `WelcomeModal.jsx` (deleted Apr 20). Only lingers in docs + schema.
**Fix options:**
- **A (keep doing what we do, just clean up docs):** no code changes, just remove mentions of the flag from CLAUDE.md and README.
- **B (retire the column):** schema migration to `DROP COLUMN has_seen_welcome`, remove from seed-demo writes.
**Size:** A is 5 min, B is ~15 min with a migration.

### #4 — `demo_seeded` stays stale after IBKR sync **[LOW / cosmetic]**
**Path:** user connects IBKR and syncs successfully.
**Problem:** `api/sync.js` (line 299-300) deletes is_demo rows + sets `ibkr_connected=true`, but does NOT reset `demo_seeded=false`. Since the banner condition requires `!ibkr_connected`, this is purely a stale-flag issue — no user impact.
**Fix:** add `demo_seeded: false` to the subscription update in sync.js. Or leave it — the flag is informational.
**Size:** 1 line.

### #5 — Password reset has no landing route **[LOW / already documented]**
See SETUP.md "Known gaps." Supabase handles the auth hash automatically, but there's no custom UI to actually set a new password. User gets logged in and has to navigate to settings manually — but we don't have a "change password" there either. Not ship-blocking because the workflow isn't promoted heavily, but worth fixing before GA.

---

## 5. Redundancies + dead code

### Confirmed dead
- **`has_seen_welcome` column reads** — zero. (See bug #3.)
- **`WelcomeModal.jsx`** — already deleted, no stray references.
- **`isActive` branch for `subscription_status === 'trialing'` with unset dates** — technically reachable if Stripe webhook hasn't populated `trial_ends_at` yet. Belt-and-suspenders, kept.

### Minor redundancies (not bugs, just shape)
- **Two fetches on non-anon first login** — the auth effect peeks at `user_subscriptions` raw (lines 181-185), then calls `fetchSubscription` (line 191) which does the same query. Could combine into one — `fetchSubscription` already returns the row, we just need to use its return value before deciding to seed. ~5 lines of cleanup, no user impact.
- **Window-focus listener refetches subscription** (lines 198-206) on every tab focus. Useful for tab-switchers but could spam the DB. Consider debouncing or removing for beta. No current user impact.
- **Two places compute `isActive(sub)`** — App.jsx has it as a module-level function. No other implementation. Not actually duplicated. ✓

### Overlapping banners?
App.jsx line 73:
```js
{isAnonymous ? <AnonymousBanner /> : (showDemoBanner && <DemoBanner />)}
```
Mutually exclusive — one or the other, never both. ✓

---

## 6. Edge cases I sanity-checked

- **User closes tab during Stripe webhook** → returns with no `?checkout=success`. Auth effect fetches subscription → if webhook already fired, shows AppShell. If not, shows PaywallScreen, user can click Subscribe to retry checkout (goes through createCheckoutSession which is idempotent on `stripe_customer_id`).
- **Anonymous user's demo data on signup conversion** → user.id is preserved via `updateUser`, demo rows stay attached. But bug #1 means `demo_seeded` flag never flips. Fix addresses that.
- **Comped user connects IBKR and syncs** → webhook skips subscription updates for comped users, sync.js still writes `ibkr_connected=true`. Works correctly.
- **Demo user converts to real user → rebuild runs** → is_demo rows get treated as normal trades by the FIFO builder, which is fine because they're self-consistent.
- **Canceled user reactivates** → Stripe would send a new `checkout.session.completed`, webhook upserts subscription back to active. Works.

---

## 7. Recommended fix order

**Before beta (this week):**
1. Bug #1 — converted-anon banner (3 lines in seed-demo.js)
2. Bug #2 — ibkr_connected reset on remove (5 lines in IBKRScreen.jsx)

**Post-beta cleanup:**
3. Bug #3 — remove `has_seen_welcome` flag + doc mentions
4. Bug #4 — reset `demo_seeded` on sync.js (1 line, cosmetic)
5. The double-fetch in App.jsx auth effect (5 lines)

**Future product work:**
6. Bug #5 — build an actual `/reset-password` UI
7. The window-focus subscription refetch — decide if it's worth keeping

---

## 8. What I did NOT find

- No security issues. RLS is correctly applied (per earlier `docs/CODE-AUDIT.md`).
- No banner overlap bugs.
- No dead imports in auth-related files.
- No subscription polling that would spin forever.
- No state where a user can get "wedged" (stuck on a loading screen with no escape) — every path either resolves to AppShell, PaywallScreen, or AuthScreen eventually.

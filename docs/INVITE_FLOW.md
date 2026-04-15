# How to invite a beta user

Use this for your first 10 users (and any comped accounts later). It
bypasses Stripe entirely — no card required, no trial, no webhook race.

## One-time setup (if not already done)

Make sure the `invited_users` table exists in Supabase. If you have
migrations running, `supabase/migrations/20260415_create_invited_users.sql`
handles it. Otherwise the table is already there in your live project.

## Inviting someone — 3 steps

### 1. Insert a row in Supabase SQL Editor

```sql
INSERT INTO invited_users (token, email)
VALUES ('pick-a-random-string-here', 'friend@example.com');
```

Rules for the token:
- Any unique string works — UUIDs are fine, or you can make them readable
- Avoid characters that need URL-encoding (`?`, `&`, `#`, `=`, spaces)
- Recommended pattern: `gen_random_uuid()::text` for guaranteed uniqueness

Quick one-liner that generates a random token for you:

```sql
INSERT INTO invited_users (token, email)
VALUES (gen_random_uuid()::text, 'friend@example.com')
RETURNING token;
```

Copy the returned token.

### 2. Build the invite link

Format:

```
https://ct3000-react.vercel.app/?invite=<TOKEN>
```

(Replace with your actual production domain if different.)

### 3. Send it

Email, DM, Slack, whatever. Recipient clicks the link. The AuthScreen
detects `?invite=<token>` and flips into invite mode showing a signup
form with the headline "You've been invited to CT3000."

They enter email + password — **must match the email you registered
the invite for** — and submit. Within seconds they're logged in with
an active comped subscription.

## What happens behind the scenes

1. `AuthScreen.jsx:118` POSTs to `/api/redeem-invite` with `{ token, email, password }`
2. `api/redeem-invite.js`:
   - Looks up the invite by token
   - Verifies `redeemed_at` is null
   - Verifies the email matches
   - Creates the auth user with `email_confirm: true` (no verification email)
   - Inserts `user_subscriptions` row with `subscription_status='active'`, `is_comped=true`
   - Marks the invite redeemed (`redeemed_at`, `redeemed_by`)
3. The new user lands on the Home screen with a fully active account

## Error modes and what the user sees

| What went wrong | Error message |
|---|---|
| Token not found | "This invite link is invalid or has already been used" |
| Already redeemed | Same as above |
| Wrong email (doesn't match invite) | "This invite is for `<invite.email>` — please use that email address" |
| Email already has an account | "An account with this email already exists. Please log in instead." |
| Any server error | Generic error from Supabase |

## Tracking redeemed invites

```sql
SELECT email, invited_at, redeemed_at, redeemed_by
FROM invited_users
ORDER BY invited_at DESC;
```

`redeemed_by` will contain the `auth.users.id` of whoever used it — so
you can cross-reference with `user_subscriptions` to see which of your
comped users are actually active.

## Revoking an invite

Just delete the row, or if you want to keep it for audit:

```sql
UPDATE invited_users
SET redeemed_at = now(), redeemed_by = NULL
WHERE token = '<token>';
```

Revoking AFTER someone has redeemed does nothing — they already have
an account. To disable their access, you'd revoke their subscription
in `user_subscriptions` instead.

## Not yet implemented

A few things are in the schema but unused by the code today:

- **`is_comped`** — always hardcoded to `true` in the subscription insert.
  If you want paid-trial invites that convert to Stripe later, you'd
  read this flag.
- **`trial_months`** — ignored. Subscriptions are set `'active'` with no
  end date, so invited users are effectively forever-comped. If you
  want N-month trials that expire, you'd wire this through.

For 10 beta users, the current behavior (forever comped) is fine.
Revisit when you scale past beta.

# Invite flow — redemption side

> **Note:** invite creation happens in the separate **ct3000-admin** app,
> which shares the same Supabase project. This doc describes the half
> of the flow that lives in *this* repo (CT3000) — redeeming an invite
> the admin app already generated. For how invites are generated,
> see the ct3000-admin codebase.

## Contract between the two apps

Both apps agree on the `invited_users` table schema. Columns both sides care about:

| Column | Type | Owner | Notes |
|---|---|---|---|
| `id` | uuid | db default | primary key, auto-generated |
| `email` | text | admin writes | must match what the user enters on redeem |
| `token` | text | admin writes | unique identifier, used in URL |
| `is_comped` | boolean | admin writes | **currently ignored by CT3000** — all invites are comped regardless |
| `trial_months` | integer | **unused** | leftover column, neither app reads or writes |
| `invited_at` | timestamptz | db default | when the admin created the invite |
| `redeemed_at` | timestamptz | CT3000 writes | set on successful redemption |
| `redeemed_by` | uuid | CT3000 writes | `auth.users.id` of who redeemed — see bug note below |

**Historical bug:** CT3000 was writing `redeemed_by_user_id` (doesn't exist) instead of `redeemed_by`. Fixed in commit `3a290dc1`. Old invites redeemed before that fix will have `NULL` in `redeemed_by` even though they were successfully claimed.

## How the admin creates an invite

In **ct3000-admin**, this code runs (e.g. from `PhiloinvestorScreen.jsx`):

```js
const token = crypto.randomUUID()
await supabase.from('invited_users').insert({
  email: 'beta-user@example.com',
  token,
  is_comped: true,
})
// Link: https://ct3000-react.vercel.app/signup?invite=<token>
```

The admin UI shows the pending invites list with "Copy link" buttons. That's the primary way to generate and share invite links.

## How CT3000 redeems an invite

1. User opens the link `https://ct3000-react.vercel.app/signup?invite=<token>`
2. No session exists, so `App.jsx` renders `<AuthScreen />` directly (bypassing routes — see URL path note below)
3. `AuthScreen.jsx:37` reads `?invite=` from the URL and flips to `invite` mode
4. User enters email + password on the invite signup form. The email **must match** the email the invite was generated for.
5. Form submits to `POST /api/redeem-invite` with `{ token, email, password }`
6. `api/redeem-invite.js`:
   - Looks up the invite by token in `invited_users`
   - Verifies `redeemed_at IS NULL`
   - Verifies the email matches (case-insensitive)
   - Creates the auth user via `supabaseAdmin.auth.admin.createUser` with `email_confirm: true` (no email verification needed)
   - Inserts a `user_subscriptions` row with `subscription_status='active'`, `is_comped=true`
   - Marks the invite `redeemed_at = now()`, `redeemed_by = user.id`
7. Response → client → user lands in the app, fully active

## URL path quirk: `/signup`

The admin generates links with `/signup?invite=<token>`, but **CT3000 has no `/signup` route**. This works purely by accident:

- If the user is **logged out** → `App.jsx` renders `<AuthScreen />` before any route matching happens. `AuthScreen` reads `window.location.search.get('invite')` regardless of the path. Works fine.
- If the user is **already logged in** → `<Route path="*" element={<Navigate to="/" replace />} />` catches `/signup`, redirects to `/`, and **drops the `?invite=` query param**. The invite goes unused.

**Gotcha to communicate:** if you send someone an invite link and they're already logged into a different account in the same browser, they should either sign out first or open the link in incognito.

**Possible cleanup later:** add an explicit `/signup` route that renders `<AuthScreen />` so the URL shape becomes intentional instead of coincidental. Not blocking beta.

## Error modes the user sees

| What went wrong | Error shown |
|---|---|
| Token not in `invited_users` | "This invite link is invalid or has already been used" |
| `redeemed_at IS NOT NULL` | Same as above |
| Email doesn't match the invite | "This invite is for `<invite.email>` — please use that email address" |
| Email already has an account | "An account with this email already exists. Please log in instead." |
| Any server / Supabase error | Generic error from Supabase |

## Manual fallback — raw SQL

If the admin app is down or you just want to comp someone quickly from the Supabase SQL editor:

```sql
INSERT INTO invited_users (token, email, is_comped)
VALUES (gen_random_uuid()::text, 'friend@example.com', true)
RETURNING token;
```

Then build the link: `https://ct3000-react.vercel.app/signup?invite=<token>` and share it. Same redemption path, same result.

## Tracking who redeemed what

```sql
SELECT email, invited_at, redeemed_at, redeemed_by
FROM invited_users
ORDER BY invited_at DESC;
```

`redeemed_by` contains `auth.users.id` for invites redeemed after commit `3a290dc1`. Earlier redemptions will have `NULL`.

## Revoking an invite

**Before redemption:** delete the row (or set `redeemed_at = now()` so it looks used).

```sql
DELETE FROM invited_users WHERE token = '<token>';
```

**After redemption:** the invite itself is done, the user has an account. To revoke their access, update `user_subscriptions.subscription_status = 'canceled'` for that user.

## Known non-issues / cruft

- **`is_comped` on the invite row is ignored.** CT3000 hardcodes comped=true on the user_subscriptions insert regardless of what the admin set. If you ever need paid-trial invites, plumb this through.
- **`trial_months` is unused everywhere.** Leftover column. Neither app touches it.
- **Path mismatch `/signup` vs no route.** Works by accident. Tolerate for now.

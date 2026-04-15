-- Schema source-of-truth for the `invited_users` table that powers the
-- redeem-invite flow (api/redeem-invite.js + AuthScreen invite mode).
--
-- This table already exists in the live Supabase project — it was created
-- via the dashboard, not via migration — so this file uses CREATE TABLE
-- IF NOT EXISTS to be safe. Its purpose is to check the schema into the
-- repo so a fresh environment can be bootstrapped from migrations alone.
--
-- Typical invite flow:
--   1. Admin inserts a row: (token, email) — the token is a random string
--      you put in a URL like `https://yourapp.com/?invite=<token>`
--   2. Recipient opens the link → AuthScreen flips to invite mode
--   3. They submit email + password → /api/redeem-invite creates the auth
--      user, creates a comped subscription, marks the invite redeemed

create table if not exists invited_users (
  id            uuid primary key default gen_random_uuid(),
  email         text not null,
  token         text not null unique,
  is_comped     boolean default true,
  trial_months  integer,
  invited_at    timestamptz not null default now(),
  redeemed_at   timestamptz,
  redeemed_by   uuid references auth.users(id)
);

-- RLS — invited_users contains sensitive tokens, should be service_role only.
-- The 20260414_fix_missing_rls.sql migration already enables RLS with no
-- policies, which locks it to service_role. Safe to re-assert here for
-- fresh environments:
alter table invited_users enable row level security;

-- No policies — only api/redeem-invite.js (service_role) reads or writes this.

-- Mirror Stripe-side state on user_subscriptions so admin / debugging can
-- see what Stripe actually thinks, separately from the gate columns the
-- paywall uses (which is_comped overrides).
--
-- Layout:
--   gate columns                        — what app uses to decide access
--     subscription_status               — 'active' / 'trialing' / etc; comp wins
--     trial_ends_at                     — comp pins to 2099
--     current_period_ends_at            — comp pins to 2099
--     is_comped                         — manual override
--
--   mirror columns (added here)         — what Stripe actually has, regardless
--     stripe_subscription_status        — Stripe's view of status
--     stripe_trial_end                  — Stripe's trial_end
--     stripe_current_period_end         — Stripe's current_period_end
--     stripe_canceled_at                — Stripe's canceled_at
--     stripe_synced_at                  — when webhook / backfill last touched these
--
-- The webhook always writes mirror columns; gate columns are still skipped
-- for comped users so paywall stays correct.
alter table user_subscriptions
  add column if not exists stripe_subscription_status   text,
  add column if not exists stripe_trial_end             timestamptz,
  add column if not exists stripe_current_period_end    timestamptz,
  add column if not exists stripe_canceled_at           timestamptz,
  add column if not exists stripe_synced_at             timestamptz;

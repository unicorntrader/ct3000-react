-- Stripe webhook idempotency. Stripe retries webhook delivery on any 5XX,
-- network blip, or function-timeout. Without dedup, a retried
-- checkout.session.completed could re-run and mutate state again
-- (downgrade an active sub back to trialing, reset trial_ends_at, etc).
--
-- The handler tries to insert event.id at the top; the unique pk causes
-- a duplicate-key error on retries which is the signal to bail with 200.
create table if not exists processed_stripe_events (
  event_id     text primary key,
  event_type   text,
  processed_at timestamptz not null default now()
);

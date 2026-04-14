-- Cleanup: remove all demo rows seeded by seed-demo.js across every table it writes to.
--
-- Tables seeded (in insertion order from seed-demo.js):
--   1. planned_trades   — 5 rows (NVDA, AAPL, TSLA, SPY, MSFT plans)
--   2. logical_trades   — 23 rows (20 closed + 3 open positions)
--   3. open_positions   — 5 rows (NVDA 50, AAPL 100, TSLA 20, SPY 10, MSFT 30)
--   4. playbooks        — 2 rows (Momentum Breakout, Earnings Fade)
--   5. user_subscriptions — UPDATE only (sets has_seen_welcome=true, demo_seeded=true); no rows inserted
--   6. anonymous_sessions — UPSERT (admin tracking only, not user-visible data)
--
-- All demo rows carry is_demo = true. Safe to delete unconditionally on that flag.
-- Run this once in the Supabase SQL editor.

delete from planned_trades   where is_demo = true;
delete from logical_trades   where is_demo = true;
delete from open_positions   where is_demo = true;
delete from playbooks        where is_demo = true;

-- Reset the demo_seeded flag on any real user subscriptions that were previously seeded
-- (was set by the now-blocked WelcomeModal → seed-demo path)
update user_subscriptions set demo_seeded = false where demo_seeded = true;

-- anonymous_sessions is admin telemetry — leave it in place.
-- The rows are harmless and useful for tracking anonymous session volume.

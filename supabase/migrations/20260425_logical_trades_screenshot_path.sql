-- Add screenshot_path column to logical_trades.
-- Stores the path of an uploaded chart screenshot in the trade-screenshots
-- Storage bucket. Path shape: {user_id}/{opening_ib_order_id}_{conid_or_0}.jpg
--
-- Survives rebuilds via the existing preservation mechanism in
-- api/_lib/rebuildForUser.js — keyed by (opening_ib_order_id, conid).

alter table public.logical_trades
  add column if not exists screenshot_path text;

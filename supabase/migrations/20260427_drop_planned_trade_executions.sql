-- Drop planned_trade_executions — its sibling logical_trade_executions was
-- removed on 20260425_drop_dead_logical_trade_columns.sql alongside dead
-- logical_trades columns; this one survived but had the same fate (zero
-- code references, only mentioned in comments). Spotted in the
-- 2026-04-27 schema-vs-code audit.
--
-- Schema before drop (for the record):
--   id                    bigint
--   logical_trade_id      bigint
--   planned_trade_id      bigint
--   matching_confidence   varchar
--   matched_by            varchar
--   matched_at            timestamptz
--   created_at            timestamptz
--
-- Plan-to-execution matching now lives entirely on logical_trades.
-- planned_trade_id + matching_status. No data migration needed —
-- the table held no rows the app ever read.

drop table if exists public.planned_trade_executions;

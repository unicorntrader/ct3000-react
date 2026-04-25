-- =============================================================================
-- Drop dead logical-trade schema (audit 2026-04-25)
-- =============================================================================
-- The 2026-04-25 dead-column audit (see docs/BACKLOG.md "Schema cleanup")
-- found four objects written by old code paths but never read by the
-- current app:
--
--   * logical_trades.account_id   — duplicate of trades.account_id +
--                                   user_ibkr_credentials.account_id
--   * logical_trades.is_reversal  — set on C;O reversal LTs; never queried
--   * logical_trades.source_notes — explanatory text; never displayed
--   * logical_trade_executions    — provenance join table; rebuild stopped
--                                   populating it, DV stopped reading it
--
-- Writes were already removed from the codebase. This migration formalises
-- the schema drop. All statements are idempotent (`if exists`) so this is
-- safe to re-apply: it has already been run by hand against prod via the
-- Supabase dashboard, so on prod it will no-op. On a fresh dev environment
-- bootstrapped from the baseline snapshot, it brings the schema in line
-- with what the app actually uses.
-- =============================================================================

alter table public.logical_trades
  drop column if exists account_id,
  drop column if exists is_reversal,
  drop column if exists source_notes;

drop table if exists public.logical_trade_executions;

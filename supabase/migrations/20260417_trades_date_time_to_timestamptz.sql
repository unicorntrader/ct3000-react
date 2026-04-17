-- Migrate trades.date_time from varchar(20) to timestamptz.
-- Coordinates with a code change in api/sync.js that now converts IBKR's
-- compact format ("YYYYMMDD;HHMMSS") to 19-char ISO at parse time. Going
-- forward, every new row is ISO and casts cleanly; this USING clause
-- handles historical rows still in the old IBKR format.
--
-- RUN ORDER:
--   1. Ship the code change (api/sync.js + both logicalTradeBuilder
--      toMs/parseDateTime helpers accept both formats).
--   2. Verify deploy.
--   3. Run this migration.
--
-- After this runs, parseDateTime's IBKR-compact fallback branch is
-- theoretically unreachable -- safe to simplify in a follow-up cleanup.

ALTER TABLE public.trades
  ALTER COLUMN date_time TYPE timestamptz
  USING CASE
    WHEN date_time ~ '^[0-9]{8};[0-9]{6}$'
      THEN to_timestamp(
             substring(date_time FROM 1 FOR 8) || ' ' || substring(date_time FROM 10 FOR 6),
             'YYYYMMDD HH24MISS'
           ) AT TIME ZONE 'UTC'
    ELSE date_time::timestamptz
  END;

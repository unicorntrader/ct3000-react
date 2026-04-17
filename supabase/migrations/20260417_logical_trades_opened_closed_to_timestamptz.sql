-- Migrate logical_trades.opened_at and closed_at from varchar(20) to
-- timestamptz. The old schema stored IBKR-style strings
-- ("YYYY-MM-DDTHH:MM:SSZ") as text -- exactly 20 chars. That forced string
-- math everywhere and blocked longer ISO timestamps (incl. .sss
-- milliseconds from .toISOString()).
--
-- The new column type accepts any ISO 8601 string as input, stores in UTC
-- internally, and serializes to ISO 8601 on read (via PostgREST). The
-- existing frontend code that does `closed_at.slice(0, 10)` continues to
-- work because the serialized form still starts with "YYYY-MM-DD".
--
-- Every existing row was produced by parseDateTime() in logicalTradeBuilder,
-- which outputs "YYYY-MM-DDTHH:MM:SSZ" -- a valid timestamptz cast target.
-- A pre-flight scan found 0 malformed rows.
--
-- NOTE: trades.date_time is still varchar(20) in IBKR compact format
-- ("YYYYMMDD;HHMMSS"). That migration needs to ship alongside an
-- api/sync.js update so parsing happens in application code rather than
-- a SQL USING clause. Deferred intentionally.

ALTER TABLE public.logical_trades
  ALTER COLUMN opened_at TYPE timestamptz USING opened_at::timestamptz;

ALTER TABLE public.logical_trades
  ALTER COLUMN closed_at TYPE timestamptz USING NULLIF(closed_at, '')::timestamptz;

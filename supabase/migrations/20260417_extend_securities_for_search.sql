-- Prepare securities table for bulk import from user's IBKR-derived SQLite
-- source (~11k rows with conid, skipping ~1.3k without). PlanSheet will use
-- company_name + description for richer autocomplete ("Apple" -> AAPL).
--
-- conid stays as the primary key (options chains, trade matching, and
-- related-history lookups all key off it).

-- Source descriptions go up to 245 chars; current cap is 128.
ALTER TABLE public.securities ALTER COLUMN description TYPE text;

-- Company name added for name-based search (not just ticker prefix).
ALTER TABLE public.securities ADD COLUMN IF NOT EXISTS company_name text;

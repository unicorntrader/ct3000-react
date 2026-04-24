-- Track cron-sync failures so the Home banner can surface them and so we can
-- tell "nothing synced" apart from "sync was tried and failed".
alter table user_ibkr_credentials
  add column if not exists last_sync_error       text,
  add column if not exists last_sync_failed_at   timestamptz;

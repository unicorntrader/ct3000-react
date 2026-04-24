-- Per-user toggle for the nightly cron sync. Default true: new users get
-- auto-sync from day one. Existing users flip off via the Auto-sync toggle
-- on the IBKR screen.
alter table user_ibkr_credentials
  add column if not exists auto_sync_enabled boolean not null default true;

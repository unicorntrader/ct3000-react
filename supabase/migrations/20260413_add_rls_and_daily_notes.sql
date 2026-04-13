-- ============================================================
-- RLS for tables that were missing it
-- ============================================================

-- trades
alter table trades enable row level security;

create policy "Users can select own trades"
  on trades for select using (auth.uid() = user_id);

create policy "Users can insert own trades"
  on trades for insert with check (auth.uid() = user_id);

create policy "Users can update own trades"
  on trades for update using (auth.uid() = user_id);

create policy "Users can delete own trades"
  on trades for delete using (auth.uid() = user_id);


-- logical_trades
alter table logical_trades enable row level security;

create policy "Users can select own logical_trades"
  on logical_trades for select using (auth.uid() = user_id);

create policy "Users can insert own logical_trades"
  on logical_trades for insert with check (auth.uid() = user_id);

create policy "Users can update own logical_trades"
  on logical_trades for update using (auth.uid() = user_id);

create policy "Users can delete own logical_trades"
  on logical_trades for delete using (auth.uid() = user_id);


-- planned_trades
alter table planned_trades enable row level security;

create policy "Users can select own planned_trades"
  on planned_trades for select using (auth.uid() = user_id);

create policy "Users can insert own planned_trades"
  on planned_trades for insert with check (auth.uid() = user_id);

create policy "Users can update own planned_trades"
  on planned_trades for update using (auth.uid() = user_id);

create policy "Users can delete own planned_trades"
  on planned_trades for delete using (auth.uid() = user_id);


-- open_positions (fully replaced on each sync, so delete is needed)
alter table open_positions enable row level security;

create policy "Users can select own open_positions"
  on open_positions for select using (auth.uid() = user_id);

create policy "Users can insert own open_positions"
  on open_positions for insert with check (auth.uid() = user_id);

create policy "Users can update own open_positions"
  on open_positions for update using (auth.uid() = user_id);

create policy "Users can delete own open_positions"
  on open_positions for delete using (auth.uid() = user_id);


-- user_ibkr_credentials
alter table user_ibkr_credentials enable row level security;

create policy "Users can select own ibkr_credentials"
  on user_ibkr_credentials for select using (auth.uid() = user_id);

create policy "Users can insert own ibkr_credentials"
  on user_ibkr_credentials for insert with check (auth.uid() = user_id);

create policy "Users can update own ibkr_credentials"
  on user_ibkr_credentials for update using (auth.uid() = user_id);

create policy "Users can delete own ibkr_credentials"
  on user_ibkr_credentials for delete using (auth.uid() = user_id);


-- ============================================================
-- daily_notes — persists DailyView journal entries
-- ============================================================

create table if not exists daily_notes (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  date_key   date not null,
  note       text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, date_key)
);

alter table daily_notes enable row level security;

create policy "Users can select own daily_notes"
  on daily_notes for select using (auth.uid() = user_id);

create policy "Users can insert own daily_notes"
  on daily_notes for insert with check (auth.uid() = user_id);

create policy "Users can update own daily_notes"
  on daily_notes for update using (auth.uid() = user_id);

create policy "Users can delete own daily_notes"
  on daily_notes for delete using (auth.uid() = user_id);

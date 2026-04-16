-- Weekly reflection notes saved per ISO week from the Performance Review screen.
-- The user types answers to the key review questions (what worked, what didn't,
-- recurring patterns, action items) and we persist them so they can look back
-- over time and see if patterns are actually changing.

create table if not exists weekly_reviews (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  week_key   text not null,  -- ISO week string, e.g. '2026-W15'
  worked     text,           -- "What worked well?"
  didnt_work text,           -- "What didn't?"
  recurring  text,           -- "Is this a recurring pattern?"
  action     text,           -- "Action for next week"
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, week_key)
);

alter table weekly_reviews enable row level security;

create policy "Users can select own weekly_reviews"
  on weekly_reviews for select using (auth.uid() = user_id);

create policy "Users can insert own weekly_reviews"
  on weekly_reviews for insert with check (auth.uid() = user_id);

create policy "Users can update own weekly_reviews"
  on weekly_reviews for update using (auth.uid() = user_id);

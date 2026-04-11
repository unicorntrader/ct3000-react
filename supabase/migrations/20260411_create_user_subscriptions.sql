create table if not exists user_subscriptions (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references auth.users(id) on delete cascade,
  stripe_customer_id    text,
  stripe_subscription_id text,
  subscription_status   text not null default 'trialing',
  trial_ends_at         timestamptz,
  current_period_ends_at timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (user_id),
  unique (stripe_customer_id),
  unique (stripe_subscription_id)
);

alter table user_subscriptions enable row level security;

create policy "Users can read own subscription"
  on user_subscriptions for select
  using (auth.uid() = user_id);

create policy "Users can insert own subscription"
  on user_subscriptions for insert
  with check (auth.uid() = user_id);

create policy "Users can update own subscription"
  on user_subscriptions for update
  using (auth.uid() = user_id);

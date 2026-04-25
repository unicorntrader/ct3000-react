-- Storage bucket for user-uploaded chart screenshots attached to trades.
-- Private bucket — files are accessed via signed URLs from the browser
-- after RLS grants per-user-folder access.
--
-- Path convention: {user_id}/{opening_ib_order_id}_{conid_or_0}.jpg
-- The leading folder segment must match auth.uid() — RLS enforces.

insert into storage.buckets (id, name, public)
values ('trade-screenshots', 'trade-screenshots', false)
on conflict (id) do nothing;

-- Per-user-folder access. The folder segment guard
--   (storage.foldername(name))[1] = auth.uid()::text
-- ensures a user can only touch objects under their own UID prefix.

drop policy if exists "Users read own trade screenshots" on storage.objects;
create policy "Users read own trade screenshots"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'trade-screenshots'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Users insert own trade screenshots" on storage.objects;
create policy "Users insert own trade screenshots"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'trade-screenshots'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Users update own trade screenshots" on storage.objects;
create policy "Users update own trade screenshots"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'trade-screenshots'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Users delete own trade screenshots" on storage.objects;
create policy "Users delete own trade screenshots"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'trade-screenshots'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

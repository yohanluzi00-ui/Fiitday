drop policy if exists items_insert_own on public.items;
create policy items_insert_own on public.items for insert to authenticated with check (auth.uid() = user_id and (select public.can_sync()));
drop policy if exists items_update_own on public.items;
create policy items_update_own on public.items for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id and (select public.can_sync()));
drop policy if exists shares_insert_own on public.shares;
create policy shares_insert_own on public.shares for insert to authenticated with check (auth.uid() = user_id and (select public.can_sync()));

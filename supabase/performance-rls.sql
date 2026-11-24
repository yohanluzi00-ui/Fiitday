-- auth.uid() calculé une fois par requête au lieu d'une fois par ligne (conseil de performance Supabase) ; mêmes règles
alter policy items_select_own on public.items using ((select auth.uid()) = user_id);
alter policy items_delete_own on public.items using ((select auth.uid()) = user_id);
alter policy items_insert_own on public.items with check (((select auth.uid()) = user_id) and (select public.can_sync()));
alter policy items_update_own on public.items using ((select auth.uid()) = user_id) with check (((select auth.uid()) = user_id) and (select public.can_sync()));
alter policy shares_delete_own on public.shares using ((select auth.uid()) = user_id);
alter policy shares_insert_own on public.shares with check (((select auth.uid()) = user_id) and (select public.can_sync()));

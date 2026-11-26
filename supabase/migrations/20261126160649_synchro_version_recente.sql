-- Synchro : le serveur garde toujours la version la plus récente d'un élément (programme, séance, réglages).
-- Une version plus ancienne envoyée en retard par un autre appareil est ignorée : l'appli (V1.133 et plus) voit qu'elle
-- n'a pas été enregistrée, relit la version du serveur et fusionne les deux. Rien d'autre ne change.
create or replace function public.items_keep_newest() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.updated_at < old.updated_at then return null; end if; -- version plus ancienne : la ligne du serveur est gardée
  return new;
end $$;
drop trigger if exists items_keep_newest on public.items;
-- s'exécute avant items_touch (ordre alphabétique) : une version ignorée ne change pas non plus server_at
create trigger items_keep_newest before update on public.items
for each row execute function public.items_keep_newest();

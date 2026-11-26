-- Un compte ne peut pas remplir toute la base : au plus 20 000 éléments et 50 Mo par compte, 200 Ko par élément
-- (aujourd'hui : 141 éléments pour le plus gros compte, 4,4 Ko pour le plus gros élément).
create table if not exists public.items_usage (
  user_id uuid primary key references auth.users (id) on delete cascade,
  n integer not null default 0,
  bytes bigint not null default 0
);
alter table public.items_usage enable row level security;
revoke all on public.items_usage from public, anon, authenticated;
insert into public.items_usage (user_id, n, bytes)
  select i.user_id, count(*), coalesce(sum(octet_length(i.data::text)), 0) from public.items i group by i.user_id
  on conflict (user_id) do update set n = excluded.n, bytes = excluded.bytes;

-- avant l'écriture : refus au-delà des limites (le reste de la synchro continue, l'appli signale l'élément refusé)
create or replace function public.items_quota() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  sz bigint := octet_length(new.data::text);
  old_sz bigint := 0;
  u_n integer := 0; u_bytes bigint := 0;
begin
  if tg_op = 'INSERT' and exists (select 1 from public.items i where i.user_id = new.user_id and i.id = new.id) then
    return new; -- ligne déjà là (envoi « remplacer ») : contrôlée par la partie mise à jour
  end if;
  if tg_op = 'UPDATE' then old_sz := octet_length(old.data::text); end if;
  select u.n, u.bytes into u_n, u_bytes from public.items_usage u where u.user_id = new.user_id;
  if tg_op = 'INSERT' and coalesce(u_n, 0) >= 20000 then
    raise exception 'Limite de 20 000 éléments par compte atteinte' using errcode = '23514';
  end if;
  if coalesce(u_bytes, 0) - old_sz + sz > 50 * 1024 * 1024 then
    raise exception 'Limite de 50 Mo par compte atteinte' using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function public.items_quota() from public, anon, authenticated;
drop trigger if exists items_quota on public.items;
create trigger items_quota before insert or update on public.items
for each row execute function public.items_quota();

-- après l'écriture : compteur du compte tenu à jour
create or replace function public.items_usage_track() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    insert into public.items_usage (user_id, n, bytes) values (new.user_id, 1, octet_length(new.data::text))
    on conflict (user_id) do update set n = public.items_usage.n + 1, bytes = public.items_usage.bytes + excluded.bytes;
  elsif tg_op = 'UPDATE' then
    update public.items_usage set bytes = greatest(bytes - octet_length(old.data::text) + octet_length(new.data::text), 0) where user_id = new.user_id;
  else
    update public.items_usage set n = greatest(n - 1, 0), bytes = greatest(bytes - octet_length(old.data::text), 0) where user_id = old.user_id;
  end if;
  return null;
end $$;
revoke all on function public.items_usage_track() from public, anon, authenticated;
drop trigger if exists items_usage_track on public.items;
create trigger items_usage_track after insert or update or delete on public.items
for each row execute function public.items_usage_track();

-- taille maximale d'un élément : 200 Ko (au lieu de 500 Ko)
alter table public.items drop constraint if exists items_limits;
alter table public.items add constraint items_limits
  check (char_length(id) between 1 and 64 and char_length(kind) <= 20 and octet_length(data::text) < 200000) not valid;

-- Premium offert à un compte (retrouvé par son e-mail) : à vie (p_days vide) ou pour une durée
create or replace function public.admin_gift(p_email text, p_kind text, p_days int, p_note text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare uid uuid; until_ts timestamptz;
begin
  if not public.admin_ok() then return public.admin_denied(); end if;
  if p_kind not in ('solo', 'family') then raise exception 'Formule inconnue' using errcode = '22023'; end if;
  if p_days is not null and (p_days < 1 or p_days > 3650) then raise exception 'Durée invalide' using errcode = '22023'; end if;
  select au.id into uid from auth.users au where lower(au.email) = lower(btrim(p_email));
  if uid is null then raise exception 'Aucun compte Fiitday avec cet e-mail' using errcode = 'P0002'; end if;
  until_ts := case when p_days is null then null else now() + make_interval(days => p_days) end;
  insert into public.entitlements (user_id, gift_kind, gift_until, gift_note, gift_at, updated_at)
  values (uid, p_kind, until_ts, left(btrim(coalesce(p_note, '')), 200), now(), now())
  on conflict (user_id) do update set gift_kind = excluded.gift_kind, gift_until = excluded.gift_until, gift_note = excluded.gift_note, gift_at = now(), updated_at = now();
  return jsonb_build_object('ok', true, 'user_id', uid, 'until', until_ts);
end $$;

create or replace function public.admin_gift_remove(p_user uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.admin_ok() then return public.admin_denied(); end if;
  update public.entitlements set gift_kind = null, gift_until = null, gift_note = '', gift_at = null, updated_at = now() where user_id = p_user;
  if not found then raise exception 'Compte introuvable' using errcode = 'P0002'; end if;
  return jsonb_build_object('ok', true);
end $$;

-- page Abonnements : comptes avec Premium offert, chiffres, familles à surveiller (règles du journal, calculées à chaque ouverture)
create or replace function public.admin_subs()
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare res jsonb;
begin
  if not public.admin_ok() then return public.admin_denied(); end if;
  delete from public.family_log where at < now() - interval '12 months';
  delete from public.family_invites where expires_at < now() - interval '12 months';
  delete from public.family_tries where at < now() - interval '1 day';
  with fam as (
    select f.id, f.owner_id, f.invites_blocked, f.block_note, f.created_at,
      (select count(*) from public.family_members m where m.family_id = f.id) as members,
      (select count(*) from public.family_invites i where i.family_id = f.id and i.used_by is null and i.expires_at > now()) as pending,
      (select count(*) from public.family_log l where l.family_id = f.id and l.action in ('leave', 'remove') and l.at > now() - interval '60 days') as departs60,
      (select count(distinct l.user_id) from public.family_log l where l.family_id = f.id and l.action = 'join' and l.at > now() - interval '6 months') as joiners6m,
      (select count(*) from public.family_invites i where i.family_id = f.id and i.used_by is null and i.expires_at <= now() and i.expires_at > now() - interval '6 months') as expired6m,
      (select count(*) from public.family_members m where m.family_id = f.id and (select count(distinct l.family_id) from public.family_log l where l.user_id = m.user_id and l.action = 'join' and l.at > now() - interval '6 months') >= 3) as hoppers
    from public.families f
  ), flagged as (
    select fam.*, array_remove(array[
      case when departs60 > 3 then 'Plus de 3 départs en 60 jours (' || departs60 || ')' end,
      case when joiners6m > 8 then 'Plus de 8 personnes en 6 mois (' || joiners6m || ')' end,
      case when expired6m >= 3 then expired6m || ' invitations jamais acceptées en 6 mois' end,
      case when hoppers > 0 then hoppers || ' membre(s) qui changent souvent de famille' end], null) as flags
    from fam
  )
  select jsonb_build_object(
    'launch_at', (select c.launch_at from public.app_config c where c.id),
    'gifts', coalesce((select jsonb_agg(jsonb_build_object('user_id', e.user_id, 'email', au.email, 'kind', e.gift_kind, 'until', e.gift_until, 'note', e.gift_note, 'at', e.gift_at) order by e.gift_at desc)
      from public.entitlements e join auth.users au on au.id = e.user_id where e.gift_kind is not null and (e.gift_until is null or e.gift_until > now())), '[]'::jsonb),
    'counts', jsonb_build_object(
      'subscribers', (select count(*) from public.entitlements e where e.sub_kind is not null and e.sub_until > now()),
      'cancelled', (select count(*) from public.entitlements e where e.sub_kind is not null and e.sub_until > now() and e.sub_renews is false),
      'lifetime', (select count(*) from public.entitlements e where e.lifetime_kind is not null),
      'gifts', (select count(*) from public.entitlements e where e.gift_kind is not null and (e.gift_until is null or e.gift_until > now())),
      'families', (select count(*) from public.families),
      'members', (select count(*) from public.family_members)),
    'families', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'owner', au.email, 'members', x.members, 'pending', x.pending, 'blocked', x.invites_blocked, 'note', x.block_note, 'flags', to_jsonb(x.flags)) order by x.invites_blocked desc, cardinality(x.flags) desc)
      from flagged x join auth.users au on au.id = x.owner_id where cardinality(x.flags) > 0 or x.invites_blocked), '[]'::jsonb),
    'at', now()) into res;
  return res;
end $$;

create or replace function public.admin_family_block(p_family uuid, p_block boolean, p_note text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.admin_ok() then return public.admin_denied(); end if;
  update public.families set invites_blocked = p_block, blocked_at = case when p_block then now() end, block_note = left(btrim(coalesce(p_note, '')), 200) where id = p_family;
  if not found then raise exception 'Famille introuvable' using errcode = 'P0002'; end if;
  insert into public.family_log (family_id, action) values (p_family, case when p_block then 'block' else 'unblock' end);
  if p_block then delete from public.family_invites where family_id = p_family and used_by is null; end if;
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.admin_gift(text, text, int, text), public.admin_gift_remove(uuid), public.admin_subs(), public.admin_family_block(uuid, boolean, text) from public, anon;
grant execute on function public.admin_gift(text, text, int, text), public.admin_gift_remove(uuid), public.admin_subs(), public.admin_family_block(uuid, boolean, text) to authenticated;

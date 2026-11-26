-- prénom affiché dans la famille : celui des Réglages de l'appli, sinon celui du compte
create or replace function public.fam_name(uid uuid)
returns text language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(
    nullif(btrim((select i.data ->> 'firstName' from public.items i where i.user_id = uid and i.kind = 'settings' and not i.deleted order by i.updated_at desc limit 1)), ''),
    nullif(btrim((select au.raw_user_meta_data ->> 'name' from auth.users au where au.id = uid)), ''),
    'Membre')
$$;
revoke all on function public.fam_name(uuid) from public, anon, authenticated;

-- une place libérée par un départ (retrait ou départ volontaire) reste bloquée 15 jours
create or replace function public.fam_waits(fid uuid)
returns setof timestamptz language sql stable security definer set search_path = public, pg_temp as $$
  select l.at + interval '15 days' from public.family_log l
  where l.family_id = fid and l.action in ('leave', 'remove') and l.at > now() - interval '15 days' order by 1
$$;
revoke all on function public.fam_waits(uuid) from public, anon, authenticated;

create or replace function public.family_status()
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  me uuid := auth.uid();
  f public.families;
  m record;
  nm int; ni int; nw int;
begin
  if me is null then raise exception 'Connecte-toi' using errcode = '28000'; end if;
  select * into f from public.families where owner_id = me;
  if f.id is not null then
    select count(*) into nm from public.family_members where family_id = f.id;
    select count(*) into ni from public.family_invites where family_id = f.id and used_by is null and expires_at > now();
    select count(*) into nw from public.fam_waits(f.id);
    return jsonb_build_object('role', 'owner', 'blocked', f.invites_blocked, 'plan', public.plan_info(me),
      'members', coalesce((select jsonb_agg(jsonb_build_object('id', x.user_id, 'name', public.fam_name(x.user_id), 'joined_at', x.joined_at) order by x.joined_at) from public.family_members x where x.family_id = f.id), '[]'::jsonb),
      'invites', coalesce((select jsonb_agg(jsonb_build_object('code', i.code, 'label', i.label, 'created_at', i.created_at, 'expires_at', i.expires_at) order by i.created_at) from public.family_invites i where i.family_id = f.id and i.used_by is null and i.expires_at > now()), '[]'::jsonb),
      'waits', coalesce((select jsonb_agg(w) from public.fam_waits(f.id) w), '[]'::jsonb),
      'free', greatest(0, 4 - nm - ni - nw));
  end if;
  select mm.joined_at, ff.owner_id into m from public.family_members mm join public.families ff on ff.id = mm.family_id where mm.user_id = me;
  if m.owner_id is not null then
    return jsonb_build_object('role', 'member', 'plan', public.plan_info(me), 'owner_name', public.fam_name(m.owner_id), 'joined_at', m.joined_at,
      'owner_active', coalesce((public.plan_info(m.owner_id) ->> 'can_family')::boolean, false));
  end if;
  return jsonb_build_object('role', null, 'plan', public.plan_info(me));
end $$;

create or replace function public.family_invite(p_label text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  me uuid := auth.uid();
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  f public.families;
  nm int; ni int; nw int; nday int;
  b bytea; c text; i int;
  exp timestamptz := now() + interval '7 days';
begin
  if me is null then raise exception 'Connecte-toi' using errcode = '28000'; end if;
  if coalesce((public.plan_info(me) ->> 'can_family')::boolean, false) is not true then
    raise exception 'Il faut un abonnement Premium Famille pour inviter des proches' using errcode = '42501';
  end if;
  if exists (select 1 from public.family_members where user_id = me) then
    raise exception 'Tu fais partie d''une autre famille : quitte-la d''abord' using errcode = 'P0001';
  end if;
  insert into public.families (owner_id) values (me) on conflict (owner_id) do nothing;
  select * into f from public.families where owner_id = me;
  if not exists (select 1 from public.family_log where family_id = f.id and action = 'create') then
    insert into public.family_log (family_id, user_id, action) values (f.id, me, 'create');
  end if;
  if f.invites_blocked then raise exception 'Les invitations de ta famille sont suspendues : écris à contact@fiitday.com' using errcode = '42501'; end if;
  select count(*) into nday from public.family_log where family_id = f.id and action = 'invite' and at > now() - interval '1 day';
  if nday >= 10 then raise exception 'Trop d''invitations aujourd''hui : réessaie demain' using errcode = 'P0001'; end if;
  select count(*) into nm from public.family_members where family_id = f.id;
  select count(*) into ni from public.family_invites where family_id = f.id and used_by is null and expires_at > now();
  select count(*) into nw from public.fam_waits(f.id);
  if nm + ni + nw >= 4 then raise exception 'Plus de place libre dans ta famille' using errcode = 'P0001'; end if;
  for attempt in 1..20 loop
    b := uuid_send(gen_random_uuid()); c := '';
    foreach i in array array[0, 1, 2, 3, 4, 5, 9, 10] loop c := c || substr(alphabet, (get_byte(b, i) % 32) + 1, 1); end loop;
    begin
      insert into public.family_invites (code, family_id, label, expires_at) values (c, f.id, left(btrim(coalesce(p_label, '')), 40), exp);
      insert into public.family_log (family_id, user_id, action) values (f.id, me, 'invite');
      return jsonb_build_object('code', c, 'expires_at', exp);
    exception when unique_violation then null;
    end;
  end loop;
  raise exception 'Impossible de créer une invitation, réessaie' using errcode = 'P0001';
end $$;

create or replace function public.family_cancel(p_code text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare me uuid := auth.uid(); fid uuid;
begin
  if me is null then raise exception 'Connecte-toi' using errcode = '28000'; end if;
  select f.id into fid from public.families f where f.owner_id = me;
  delete from public.family_invites i where i.family_id = fid and i.code = upper(p_code) and i.used_by is null;
  if not found then raise exception 'Invitation introuvable' using errcode = 'P0001'; end if;
  insert into public.family_log (family_id, user_id, action) values (fid, me, 'cancel');
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.family_join(p_code text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  me uuid := auth.uid();
  c text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  inv public.family_invites;
  f public.families;
  cur uuid; nm int; nw int;
begin
  if me is null then raise exception 'Connecte-toi pour rejoindre une famille' using errcode = '28000'; end if;
  if (select count(*) from public.family_tries t where t.user_id = me and t.at > now() - interval '1 hour') >= 20 then
    raise exception 'Trop de codes faux : réessaie dans une heure' using errcode = 'P0001';
  end if;
  select * into inv from public.family_invites i where i.code = c and i.used_by is null and i.expires_at > now() for update;
  if inv.code is null then
    insert into public.family_tries (user_id) values (me);
    delete from public.family_tries t where t.at < now() - interval '1 day';
    raise exception 'Invitation inconnue, déjà utilisée ou expirée' using errcode = 'P0002';
  end if;
  select * into f from public.families where id = inv.family_id;
  if f.owner_id = me then raise exception 'C''est ta propre invitation : envoie-la à un proche' using errcode = 'P0001'; end if;
  if exists (select 1 from public.families where owner_id = me) then raise exception 'Tu es titulaire d''une famille : tu ne peux pas en rejoindre une autre' using errcode = 'P0001'; end if;
  select family_id into cur from public.family_members where user_id = me;
  if cur = f.id then raise exception 'Tu fais déjà partie de cette famille' using errcode = 'P0001'; end if;
  if cur is not null then raise exception 'Tu fais partie d''une autre famille : quitte-la d''abord dans Réglages › Abonnement' using errcode = 'P0001'; end if;
  if f.invites_blocked then raise exception 'Cette famille ne peut pas accueillir de nouveaux membres pour l''instant' using errcode = '42501'; end if;
  if coalesce((public.plan_info(f.owner_id) ->> 'can_family')::boolean, false) is not true then
    raise exception 'L''abonnement Famille de ton proche n''est plus actif' using errcode = 'P0001';
  end if;
  select count(*) into nm from public.family_members where family_id = f.id;
  select count(*) into nw from public.fam_waits(f.id);
  if nm + nw >= 4 then raise exception 'Cette famille est complète' using errcode = 'P0001'; end if;
  insert into public.family_members (user_id, family_id) values (me, f.id);
  update public.family_invites set used_by = me, used_at = now() where code = inv.code;
  insert into public.family_log (family_id, user_id, action) values (f.id, me, 'join');
  return jsonb_build_object('ok', true, 'owner_name', public.fam_name(f.owner_id));
end $$;

create or replace function public.family_leave()
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare me uuid := auth.uid(); fid uuid;
begin
  if me is null then raise exception 'Connecte-toi' using errcode = '28000'; end if;
  delete from public.family_members where user_id = me returning family_id into fid;
  if fid is null then raise exception 'Tu ne fais partie d''aucune famille' using errcode = 'P0001'; end if;
  insert into public.family_log (family_id, user_id, action) values (fid, me, 'leave');
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.family_remove(p_user uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare me uuid := auth.uid(); fid uuid;
begin
  if me is null then raise exception 'Connecte-toi' using errcode = '28000'; end if;
  select f.id into fid from public.families f where f.owner_id = me;
  delete from public.family_members m where m.family_id = fid and m.user_id = p_user;
  if not found then raise exception 'Ce membre n''est pas dans ta famille' using errcode = 'P0001'; end if;
  insert into public.family_log (family_id, user_id, action) values (fid, p_user, 'remove');
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.family_status(), public.family_invite(text), public.family_cancel(text), public.family_join(text), public.family_leave(), public.family_remove(uuid) from public, anon;
grant execute on function public.family_status(), public.family_invite(text), public.family_cancel(text), public.family_join(text), public.family_leave(), public.family_remove(uuid) to authenticated;

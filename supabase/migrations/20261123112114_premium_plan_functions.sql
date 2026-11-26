-- droits propres d'un compte (sans la famille) : le meilleur qui est actif ; Famille en priorité
create or replace function public.own_rights(uid uuid, at_ts timestamptz)
returns table (kind text, source text, until_ts timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
  select r.kind, r.source, r.until_ts from (
    select e.lifetime_kind as kind, 'lifetime'::text as source, null::timestamptz as until_ts, 1 as rnk from public.entitlements e where e.user_id = uid and e.lifetime_kind is not null
    union all
    select e.sub_kind, 'subscription', e.sub_until, 2 from public.entitlements e where e.user_id = uid and e.sub_kind is not null and e.sub_until > at_ts
    union all
    select e.gift_kind, 'gift', e.gift_until, 3 from public.entitlements e where e.user_id = uid and e.gift_kind is not null and (e.gift_until is null or e.gift_until > at_ts)
  ) r
  order by (r.kind = 'family') desc, r.rnk, r.until_ts desc nulls first
  limit 1
$$;
revoke all on function public.own_rights(uuid, timestamptz) from public, anon, authenticated;

-- statut d'un compte. state : off (pas encore lancé), premium, trial, free. would : le statut si l'abonnement était lancé aujourd'hui.
create or replace function public.plan_info(uid uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  launch timestamptz := (select c.launch_at from public.app_config c where c.id);
  ref_launch timestamptz;
  u_created timestamptz; u_email text;
  o_kind text; o_source text; o_until timestamptz;
  f_id uuid; f_owner uuid;
  of_kind text; of_until timestamptz;
  trial_end timestamptz;
  would text; k text; src text; until_ts timestamptz;
  live boolean;
begin
  select au.created_at, au.email into u_created, u_email from auth.users au where au.id = uid;
  if u_created is null then return jsonb_build_object('state', 'none'); end if;
  live := launch is not null and launch <= now();
  ref_launch := coalesce(launch, now());
  select r.kind, r.source, r.until_ts into o_kind, o_source, o_until from public.own_rights(uid, now()) r;
  select f.id, f.owner_id into f_id, f_owner from public.family_members m join public.families f on f.id = m.family_id where m.user_id = uid;
  if f_id is not null then select r.kind, r.until_ts into of_kind, of_until from public.own_rights(f_owner, now()) r; end if;
  -- essai : 30 jours dès la création du compte (ou dès le lancement pour les comptes créés avant) ; aucun si l'e-mail en a déjà eu un
  trial_end := greatest(u_created, ref_launch) + interval '30 days';
  if exists (select 1 from public.trial_used t where t.email_hash = public.email_hash(u_email) and t.at < u_created + interval '1 minute') then
    trial_end := u_created;
  end if;
  if o_kind is not null then would := 'premium'; k := o_kind; src := o_source; until_ts := o_until;
  elsif of_kind = 'family' then would := 'premium'; k := 'family'; src := 'family-member'; until_ts := of_until;
  elsif trial_end > now() then would := 'trial'; src := 'trial'; until_ts := trial_end;
  else would := 'free'; end if;
  return jsonb_build_object(
    'launched', live, 'launch_at', launch,
    'state', case when live then would else 'off' end,
    'would', would, 'kind', k, 'source', src, 'until', until_ts, 'trial_ends', trial_end,
    'family_role', case when exists (select 1 from public.families f where f.owner_id = uid) then 'owner' when f_id is not null then 'member' end,
    'can_family', o_kind = 'family',
    'renews', (select e.sub_renews from public.entitlements e where e.user_id = uid and o_source = 'subscription'),
    'store', (select e.sub_store from public.entitlements e where e.user_id = uid and o_source = 'subscription'),
    'at', now());
end $$;
revoke all on function public.plan_info(uuid) from public, anon, authenticated;

create or replace function public.my_plan()
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select case when auth.uid() is null then jsonb_build_object('state', 'none') else public.plan_info(auth.uid()) end
$$;
revoke all on function public.my_plan() from public, anon;
grant execute on function public.my_plan() to authenticated;

create or replace function public.can_sync()
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select auth.uid() is not null and (public.plan_info(auth.uid()) ->> 'state') in ('off', 'premium', 'trial')
$$;
create or replace function public.paid_ok()
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select auth.uid() is not null and (public.plan_info(auth.uid()) ->> 'state') in ('off', 'premium')
$$;
revoke all on function public.can_sync() from public, anon;
revoke all on function public.paid_ok() from public, anon;
grant execute on function public.can_sync() to authenticated;
grant execute on function public.paid_ok() to authenticated;

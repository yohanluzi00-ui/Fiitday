create or replace function public.admin_subs() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare res jsonb; wk jsonb;
begin
  if not public.admin_ok() then return public.admin_denied(); end if;
  delete from public.family_log where at < now() - interval '12 months';
  delete from public.family_invites where expires_at < now() - interval '12 months';
  delete from public.family_tries where at < now() - interval '1 day';
  delete from public.rc_log where at < now() - interval '24 months';
  -- résumé de la semaine (depuis lundi) et de la semaine d'avant : essais, abonnés, résiliations, ventes
  with b as (select date_trunc('week', now()) as w0, (select c.launch_at from public.app_config c where c.id) as launch),
  tr as (
    select greatest(au.created_at, b.launch) as s
    from auth.users au, b
    where b.launch is not null and b.launch <= now()
      and not exists (select 1 from public.trial_used t where t.email_hash = public.email_hash(au.email) and t.at < au.created_at + interval '1 minute')
  ),
  lg as (
    select l.*, case when l.at >= b.w0 then 0 else 1 end as wi,
      (l.type in ('INITIAL_PURCHASE', 'RENEWAL', 'NON_RENEWING_PURCHASE') and coalesce(l.period_type, '') <> 'TRIAL' and coalesce(l.amount, 0) > 0) as sale
    from public.rc_log l, b
    where l.env = 'PRODUCTION' and l.at >= b.w0 - interval '7 days' and l.at <= now()
  ),
  w as (
    select i.wi,
      (select count(*) from lg where lg.wi = i.wi and not lg.lifetime and ((lg.type = 'INITIAL_PURCHASE' and coalesce(lg.period_type, '') <> 'TRIAL') or (lg.type = 'RENEWAL' and lg.trial_conversion))) as subs,
      (select count(*) from lg where lg.wi = i.wi and lg.lifetime and lg.type in ('INITIAL_PURCHASE', 'NON_RENEWING_PURCHASE')) as life,
      (select count(*) from lg where lg.wi = i.wi and not lg.lifetime and lg.type = 'CANCELLATION') as cancels,
      (select coalesce(sum(lg.amount), 0) from lg where lg.wi = i.wi and lg.sale and lg.currency = 'EUR') as sales,
      (select count(*) from lg where lg.wi = i.wi and lg.sale and coalesce(lg.currency, '') <> 'EUR') as other
    from (values (0), (1)) as i(wi)
  )
  select jsonb_build_object(
    'launched', (select b.launch is not null and b.launch <= now() from b),
    'trials', jsonb_build_array((select count(*) from tr, b where tr.s >= b.w0 and tr.s <= now()), (select count(*) from tr, b where tr.s >= b.w0 - interval '7 days' and tr.s < b.w0)),
    'trialsNow', (select count(*) from tr where tr.s <= now() and tr.s + interval '30 days' > now()),
    'subs', jsonb_build_array((select subs from w where wi = 0), (select subs from w where wi = 1)),
    'life', jsonb_build_array((select life from w where wi = 0), (select life from w where wi = 1)),
    'cancels', jsonb_build_array((select cancels from w where wi = 0), (select cancels from w where wi = 1)),
    'sales', jsonb_build_array((select sales from w where wi = 0), (select sales from w where wi = 1)),
    'other', (select other from w where wi = 0)
  ) into wk;
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
    'week', wk,
    'families', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'owner', au.email, 'members', x.members, 'pending', x.pending, 'blocked', x.invites_blocked, 'note', x.block_note, 'flags', to_jsonb(x.flags)) order by x.invites_blocked desc, cardinality(x.flags) desc)
      from flagged x join auth.users au on au.id = x.owner_id where cardinality(x.flags) > 0 or x.invites_blocked), '[]'::jsonb),
    'at', now()) into res;
  return res;
end $$;
revoke all on function public.admin_subs() from public, anon;
grant execute on function public.admin_subs() to authenticated;

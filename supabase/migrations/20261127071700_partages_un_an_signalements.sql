-- Lot 7 de l'audit (LEG-10, conditions d'utilisation et signalement) : une séance partagée par lien est effacée 1 an après
-- sa création ; Administration › Signalements montre un partage signalé (séance, date, e-mail de l'auteur) et peut le retirer.

-- 1) purge quotidienne : + partages de plus d'un an
create or replace function public.daily_purge() returns jsonb language plpgsql security definer set search_path = '' as $$
declare a int; b int; c int; d int; e int; f int; g int; h int;
begin
  delete from public.contract_requests where coalesce(end_at, created_at) < now() - interval '5 years'; get diagnostics a = row_count;
  delete from public.purchase_consents where user_id is null and at < now() - interval '5 years'; get diagnostics b = row_count;
  delete from auth.users where email_confirmed_at is null and created_at < now() - interval '30 days'; get diagnostics c = row_count;
  delete from public.trial_used where at < now() - interval '3 years'; get diagnostics d = row_count;
  delete from public.family_log where at < now() - interval '12 months'; get diagnostics e = row_count;
  delete from public.rc_seen where at < now() - interval '90 days'; get diagnostics f = row_count;
  delete from public.order_confirmations where created_at < now() - interval '5 years'; get diagnostics g = row_count;
  delete from public.shares where created_at < now() - interval '1 year'; get diagnostics h = row_count;
  return jsonb_build_object('demandes', a, 'accords', b, 'comptes_non_verifies', c, 'empreintes', d, 'journal_familles', e, 'messages_rc', f,
    'confirmations', g, 'partages', h, 'at', now());
end $$;

-- 2) un lien de plus d'un an ne s'ouvre plus, même avant le passage de la purge de la nuit
create or replace function public.get_share(p_code text) returns jsonb language sql stable security definer set search_path = '' as $$
  select s.data from public.shares s where s.code = p_code and s.created_at > now() - interval '1 year'
$$;

-- 3) Administration › Signalements (compte admin avec le code à 6 chiffres seulement, comme les autres fonctions admin)
create or replace function public.admin_share(p_code text) returns jsonb language plpgsql security definer set search_path = 'public', 'pg_temp' as $$
declare r record;
begin
  if not public.admin_ok() then return public.admin_denied(); end if;
  select s.code, s.data, s.created_at, s.user_id, u.email into r
  from public.shares s left join auth.users u on u.id = s.user_id where s.code = btrim(coalesce(p_code, ''));
  if not found then return jsonb_build_object('found', false); end if;
  return jsonb_build_object('found', true, 'code', r.code, 'data', r.data, 'created_at', r.created_at, 'author_email', r.email,
    'author_shares', (select count(*) from public.shares s2 where s2.user_id = r.user_id));
end $$;

create or replace function public.admin_share_remove(p_code text) returns jsonb language plpgsql security definer set search_path = 'public', 'pg_temp' as $$
begin
  if not public.admin_ok() then return public.admin_denied(); end if;
  delete from public.shares where code = btrim(coalesce(p_code, ''));
  if not found then raise exception 'Partage introuvable' using errcode = 'P0002'; end if;
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.admin_share(text) from public, anon;
revoke all on function public.admin_share_remove(text) from public, anon;
grant execute on function public.admin_share(text) to authenticated, service_role;
grant execute on function public.admin_share_remove(text) to authenticated, service_role;

-- Liens de partage valables 7 jours (au lieu d'1 an) : un lien plus vieux est refusé, et la purge quotidienne l'efface.
-- Une séance déjà importée reste chez la personne qui l'a importée (c'est une copie).

create or replace function public.get_share(p_code text)
 returns jsonb
 language sql
 stable security definer
 set search_path to ''
as $function$
  select s.data from public.shares s where s.code = p_code and s.created_at > now() - interval '7 days'
$function$;

create or replace function public.daily_purge()
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare a int; b int; c int; d int; e int; f int; g int; h int;
begin
  delete from public.contract_requests where coalesce(end_at, created_at) < now() - interval '5 years'; get diagnostics a = row_count;
  delete from public.purchase_consents where user_id is null and at < now() - interval '5 years'; get diagnostics b = row_count;
  delete from auth.users where email_confirmed_at is null and created_at < now() - interval '30 days'; get diagnostics c = row_count;
  delete from public.trial_used where at < now() - interval '3 years'; get diagnostics d = row_count;
  delete from public.family_log where at < now() - interval '12 months'; get diagnostics e = row_count;
  delete from public.rc_seen where at < now() - interval '90 days'; get diagnostics f = row_count;
  delete from public.order_confirmations where created_at < now() - interval '5 years'; get diagnostics g = row_count;
  delete from public.shares where created_at < now() - interval '7 days'; get diagnostics h = row_count;
  return jsonb_build_object('demandes', a, 'accords', b, 'comptes_non_verifies', c, 'empreintes', d, 'journal_familles', e, 'messages_rc', f,
    'confirmations', g, 'partages', h, 'at', now());
end $function$;

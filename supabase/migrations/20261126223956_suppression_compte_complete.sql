-- Lot 4 de l'audit : suppression du compte complète, preuve gardée 5 ans, purges quotidiennes

-- 1) un autre appareil peut savoir qu'un compte a été supprimé (pour effacer sa copie des données) : oui / non seulement
create or replace function public.account_exists(p_uid uuid)
returns boolean language sql stable security definer set search_path = ''
as $$ select exists (select 1 from auth.users u where u.id = p_uid) $$;
revoke all on function public.account_exists(uuid) from public;
grant execute on function public.account_exists(uuid) to anon, authenticated;

-- 2) la demande de début immédiat cochée avant un achat reste comme preuve après la suppression du compte (5 ans)
alter table public.purchase_consents alter column user_id drop not null;
alter table public.purchase_consents drop constraint if exists purchase_consents_user_id_fkey;
alter table public.purchase_consents add constraint purchase_consents_user_id_fkey foreign key (user_id) references auth.users(id) on delete set null;

-- 3) clients RevenueCat encore à effacer (compte supprimé sans passer par la fonction delete-account) : effacés chaque jour
create table if not exists public.rc_pending_delete (user_id uuid primary key, at timestamptz not null default now());
alter table public.rc_pending_delete enable row level security;
revoke all on public.rc_pending_delete from anon, authenticated;

-- 4) suppression du compte : refusée tant qu'un abonnement par carte se renouvelle (la fonction delete-account l'arrête
--    d'abord) ; efface aussi les journaux qui nomment le compte
drop function if exists public.delete_my_account();
create or replace function public.delete_my_account(p_rc_done boolean default false)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  em text;
begin
  if uid is null then raise exception 'non connecté'; end if;
  if exists (select 1 from public.rc_subs s where s.user_id = uid and s.store = 'RC_BILLING' and s.renews and s.until > now()) then
    raise exception 'abonnement par carte encore actif : résilie-le d''abord (Réglages › Tes achats Premium)';
  end if;
  -- l'essai déjà utilisé reste noté 3 ans (empreinte de l'e-mail seulement, jamais l'adresse) : un compte recréé n'a pas de nouvel essai
  delete from public.trial_used t where t.at < now() - interval '3 years';
  select u.email into em from auth.users u where u.id = uid;
  if em is not null then
    insert into public.trial_used (email_hash) values (public.email_hash(em)) on conflict (email_hash) do nothing;
  end if;
  delete from public.family_log where user_id = uid;
  delete from public.family_tries where user_id = uid;
  delete from public.admin_access_log where user_id = uid;
  update public.family_invites set used_by = null where used_by = uid;
  if not coalesce(p_rc_done, false) then insert into public.rc_pending_delete (user_id) values (uid) on conflict (user_id) do nothing; end if;
  delete from auth.users where id = uid;
end $$;
revoke all on function public.delete_my_account(boolean) from public, anon;
grant execute on function public.delete_my_account(boolean) to authenticated;

-- 5) purges quotidiennes (pg_cron) : durées annoncées dans la politique de confidentialité
create or replace function public.daily_purge()
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare a int; b int; c int; d int; e int;
begin
  -- demandes de résiliation / rétractation : 5 ans après la fin du contrat (preuve en cas de litige)
  delete from public.contract_requests where coalesce(end_at, created_at) < now() - interval '5 years'; get diagnostics a = row_count;
  -- demandes de début immédiat d'un compte supprimé : 5 ans
  delete from public.purchase_consents where user_id is null and at < now() - interval '5 years'; get diagnostics b = row_count;
  -- comptes dont l'adresse e-mail n'a jamais été vérifiée : 30 jours
  delete from auth.users where email_confirmed_at is null and created_at < now() - interval '30 days'; get diagnostics c = row_count;
  -- empreinte de l'e-mail (essai déjà utilisé) : 3 ans ; journal des familles : 12 mois
  delete from public.trial_used where at < now() - interval '3 years'; get diagnostics d = row_count;
  delete from public.family_log where at < now() - interval '12 months'; get diagnostics e = row_count;
  return jsonb_build_object('demandes', a, 'accords', b, 'comptes_non_verifies', c, 'empreintes', d, 'journal_familles', e, 'at', now());
end $$;
revoke all on function public.daily_purge() from public, anon, authenticated;

do $$ begin
  if not exists (select 1 from cron.job where jobname = 'fiitday-purge-quotidienne') then
    perform cron.schedule('fiitday-purge-quotidienne', '41 3 * * *', 'select public.daily_purge()');
  end if;
end $$;

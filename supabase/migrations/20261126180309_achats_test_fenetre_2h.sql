-- Achats de test (magasin de test RevenueCat, mode test de Stripe) : acceptés pour le compte administrateur seulement
-- pendant 2 heures après l'ouverture, faite automatiquement par l'appli quand l'administrateur lance un achat de test.
-- Avant : n'importe qui connaissant l'identifiant de l'administrateur (visible dans le code du site) pouvait lui créer
-- de faux achats de test. Les messages suivants d'un achat déjà fait (renouvellement, résiliation, fin) restent acceptés.
alter table public.app_config add column if not exists test_purchases_until timestamptz;

create or replace function public.open_test_purchases() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare until_ts timestamptz := now() + interval '2 hours';
begin
  if auth.uid() is distinct from '8d8a867f-e766-41ca-b197-7694f5f5e1c4'::uuid then
    raise exception 'Réservé à l''administrateur' using errcode = '42501';
  end if;
  update public.app_config set test_purchases_until = until_ts where id;
  return jsonb_build_object('ok', true, 'until', until_ts);
end $$;
revoke all on function public.open_test_purchases() from public, anon;
grant execute on function public.open_test_purchases() to authenticated;

do $$
declare d text;
begin
  d := pg_get_functiondef('public.rc_apply(jsonb)'::regprocedure);
  d := replace(d,
    $r$if env <> 'PRODUCTION' and uid <> tester then return jsonb_build_object('applied', false, 'reason', 'achat de test ignoré'); end if;$r$,
    $r$if env <> 'PRODUCTION' and (uid <> tester or (typ in ('INITIAL_PURCHASE', 'NON_RENEWING_PURCHASE')
       and coalesce((select c.test_purchases_until from public.app_config c where c.id), '-infinity'::timestamptz) < now())) then
    return jsonb_build_object('applied', false, 'reason', 'achat de test ignoré'); end if;$r$);
  if position('test_purchases_until' in d) = 0 then raise exception 'remplacement non appliqué'; end if;
  execute d;
end $$;

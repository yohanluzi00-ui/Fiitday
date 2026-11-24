-- Achats de test réservés au compte de test, et horloge séparée pour les achats à vie
alter table public.entitlements add column if not exists life_event_at timestamptz;

create or replace function public.rc_apply(ev jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  uid uuid;
  typ text := upper(coalesce(ev ->> 'type', ''));
  product text := coalesce(nullif(ev ->> 'new_product_id', ''), ev ->> 'product_id', '');
  env text := upper(coalesce(nullif(ev ->> 'environment', ''), 'PRODUCTION'));
  -- seul compte qui reçoit Premium avec un achat de test (magasin de test RevenueCat, testeurs Google, mode test Stripe)
  tester constant uuid := '8d8a867f-e766-41ca-b197-7694f5f5e1c4';
  kind text;
  life boolean;
  ts timestamptz;
  exp timestamptz;
  last_ts timestamptz;
begin
  begin uid := (ev ->> 'app_user_id')::uuid; exception when others then uid := null; end;
  if uid is null then begin uid := (ev ->> 'original_app_user_id')::uuid; exception when others then uid := null; end; end if;
  if uid is null or not exists (select 1 from auth.users where id = uid) then return jsonb_build_object('applied', false, 'reason', 'compte inconnu'); end if;
  -- sans ce contrôle, n'importe qui ayant une appli de test pourrait s'offrir Premium avec un faux achat
  if env <> 'PRODUCTION' and uid <> tester then return jsonb_build_object('applied', false, 'reason', 'achat de test ignoré'); end if;
  ts := to_timestamp(coalesce((ev ->> 'event_timestamp_ms')::bigint, (extract(epoch from now()) * 1000)::bigint) / 1000.0);
  if ev ->> 'expiration_at_ms' is not null then exp := to_timestamp((ev ->> 'expiration_at_ms')::bigint / 1000.0); end if;
  kind := case when product ~* 'famil' then 'family' else 'solo' end;
  life := product ~* '(life|vie)';
  -- journal anonyme (compté une seule fois par message, même si RevenueCat le renvoie) ; ne bloque jamais la mise à jour du statut
  if typ in ('INITIAL_PURCHASE', 'RENEWAL', 'NON_RENEWING_PURCHASE', 'PRODUCT_CHANGE', 'CANCELLATION', 'UNCANCELLATION', 'EXPIRATION') then
    begin
      insert into public.rc_log (event_id, at, type, kind, lifetime, store, env, period_type, trial_conversion, cancel_reason, amount, currency)
      values (left(nullif(ev ->> 'id', ''), 100), ts, typ, kind, life, left(ev ->> 'store', 30), left(env, 20),
        left(upper(ev ->> 'period_type'), 20), coalesce((ev ->> 'is_trial_conversion')::boolean, false), left(upper(ev ->> 'cancel_reason'), 40),
        round((ev ->> 'price_in_purchased_currency')::numeric, 2), left(upper(ev ->> 'currency'), 3))
      on conflict (event_id) do nothing;
    exception when others then null;
    end;
  end if;
  if life then
    -- achats à vie : leur propre horloge, pour qu'un renouvellement d'abonnement plus récent ne fasse pas ignorer un achat à vie arrivé en retard
    select e.life_event_at into last_ts from public.entitlements e where e.user_id = uid;
    if last_ts is not null and ts < last_ts then return jsonb_build_object('applied', false, 'reason', 'message plus ancien que le dernier appliqué'); end if;
    if typ not in ('NON_RENEWING_PURCHASE', 'INITIAL_PURCHASE', 'CANCELLATION') then return jsonb_build_object('applied', false, 'reason', 'type ignoré : ' || typ); end if;
    insert into public.entitlements (user_id) values (uid) on conflict (user_id) do nothing;
    if typ = 'CANCELLATION' then
      -- remboursement d'un achat à vie
      update public.entitlements set lifetime_kind = null, life_event_at = ts, updated_at = now() where user_id = uid;
    else
      update public.entitlements set lifetime_kind = case when kind = 'family' or lifetime_kind = 'family' then 'family' else 'solo' end, life_event_at = ts, updated_at = now() where user_id = uid;
    end if;
  else
    select e.rc_event_at into last_ts from public.entitlements e where e.user_id = uid;
    if last_ts is not null and ts < last_ts then return jsonb_build_object('applied', false, 'reason', 'message plus ancien que le dernier appliqué'); end if;
    if typ not in ('INITIAL_PURCHASE', 'RENEWAL', 'PRODUCT_CHANGE', 'UNCANCELLATION', 'SUBSCRIPTION_EXTENDED', 'TEMPORARY_ENTITLEMENT_GRANT', 'CANCELLATION', 'EXPIRATION') then
      return jsonb_build_object('applied', false, 'reason', 'type ignoré : ' || typ);
    end if;
    insert into public.entitlements (user_id) values (uid) on conflict (user_id) do nothing;
    if typ = 'CANCELLATION' then
      -- résilié : reste Premium jusqu'à la fin de la période payée (ou fin immédiate si remboursé)
      update public.entitlements set sub_renews = false, sub_until = case when ev ->> 'cancel_reason' = 'CUSTOMER_SUPPORT' and exp is not null then least(coalesce(sub_until, exp), exp) else sub_until end, rc_event_at = ts, updated_at = now() where user_id = uid;
    elsif typ = 'EXPIRATION' then
      update public.entitlements set sub_until = least(coalesce(sub_until, now()), now()), sub_renews = false, rc_event_at = ts, updated_at = now() where user_id = uid;
    else
      update public.entitlements set sub_kind = kind, sub_until = coalesce(exp, sub_until), sub_store = left(coalesce(ev ->> 'store', sub_store), 30), sub_renews = typ <> 'TEMPORARY_ENTITLEMENT_GRANT', rc_event_at = ts, updated_at = now() where user_id = uid;
    end if;
  end if;
  return jsonb_build_object('applied', true, 'type', typ, 'kind', kind, 'lifetime', life);
end $function$;

revoke all on function public.rc_apply(jsonb) from public, anon, authenticated;
grant execute on function public.rc_apply(jsonb) to service_role;

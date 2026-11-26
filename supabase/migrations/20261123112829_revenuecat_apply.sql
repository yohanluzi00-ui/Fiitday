-- messages de RevenueCat (achat, renouvellement, résiliation, expiration, achat à vie, remboursement) appliqués aux droits du compte.
-- Appelée seulement par la fonction « revenuecat » (rôle service), jamais par l'appli.
create or replace function public.rc_apply(ev jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid uuid;
  typ text := upper(coalesce(ev ->> 'type', ''));
  product text := coalesce(nullif(ev ->> 'new_product_id', ''), ev ->> 'product_id', '');
  kind text;
  life boolean;
  ts timestamptz;
  exp timestamptz;
  last_ts timestamptz;
begin
  begin uid := (ev ->> 'app_user_id')::uuid; exception when others then uid := null; end;
  if uid is null then begin uid := (ev ->> 'original_app_user_id')::uuid; exception when others then uid := null; end; end if;
  if uid is null or not exists (select 1 from auth.users where id = uid) then return jsonb_build_object('applied', false, 'reason', 'compte inconnu'); end if;
  ts := to_timestamp(coalesce((ev ->> 'event_timestamp_ms')::bigint, (extract(epoch from now()) * 1000)::bigint) / 1000.0);
  if ev ->> 'expiration_at_ms' is not null then exp := to_timestamp((ev ->> 'expiration_at_ms')::bigint / 1000.0); end if;
  kind := case when product ~* 'famil' then 'family' else 'solo' end;
  life := product ~* '(life|vie)';
  select e.rc_event_at into last_ts from public.entitlements e where e.user_id = uid;
  if last_ts is not null and ts < last_ts then return jsonb_build_object('applied', false, 'reason', 'message plus ancien que le dernier appliqué'); end if;
  insert into public.entitlements (user_id) values (uid) on conflict (user_id) do nothing;
  if typ in ('INITIAL_PURCHASE', 'RENEWAL', 'PRODUCT_CHANGE', 'UNCANCELLATION', 'SUBSCRIPTION_EXTENDED', 'TEMPORARY_ENTITLEMENT_GRANT') and not life then
    update public.entitlements set sub_kind = kind, sub_until = coalesce(exp, sub_until), sub_store = left(coalesce(ev ->> 'store', sub_store), 30), sub_renews = typ <> 'TEMPORARY_ENTITLEMENT_GRANT', rc_event_at = ts, updated_at = now() where user_id = uid;
  elsif typ in ('NON_RENEWING_PURCHASE', 'INITIAL_PURCHASE') and life then
    update public.entitlements set lifetime_kind = case when kind = 'family' or lifetime_kind = 'family' then 'family' else 'solo' end, rc_event_at = ts, updated_at = now() where user_id = uid;
  elsif typ = 'CANCELLATION' and life then
    -- remboursement d'un achat à vie
    update public.entitlements set lifetime_kind = null, rc_event_at = ts, updated_at = now() where user_id = uid;
  elsif typ = 'CANCELLATION' then
    -- résilié : reste Premium jusqu'à la fin de la période payée (ou fin immédiate si remboursé)
    update public.entitlements set sub_renews = false, sub_until = case when ev ->> 'cancel_reason' = 'CUSTOMER_SUPPORT' and exp is not null then least(coalesce(sub_until, exp), exp) else sub_until end, rc_event_at = ts, updated_at = now() where user_id = uid;
  elsif typ = 'EXPIRATION' then
    update public.entitlements set sub_until = least(coalesce(sub_until, now()), now()), sub_renews = false, rc_event_at = ts, updated_at = now() where user_id = uid;
  else
    return jsonb_build_object('applied', false, 'reason', 'type ignoré : ' || typ);
  end if;
  return jsonb_build_object('applied', true, 'type', typ, 'kind', kind, 'lifetime', life);
end $$;
revoke all on function public.rc_apply(jsonb) from public, anon, authenticated;
grant execute on function public.rc_apply(jsonb) to service_role;

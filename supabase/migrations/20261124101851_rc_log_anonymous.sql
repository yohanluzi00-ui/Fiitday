-- Journal anonyme des achats reçus de RevenueCat (aucun lien vers un compte) : sert au résumé de la semaine de l'Administration
create table if not exists public.rc_log (
  id bigserial primary key,
  event_id text unique,
  at timestamptz not null,
  type text not null,
  kind text,
  lifetime boolean not null default false,
  store text,
  env text not null default 'PRODUCTION',
  period_type text,
  trial_conversion boolean not null default false,
  cancel_reason text,
  amount numeric,
  currency text,
  received_at timestamptz not null default now()
);
alter table public.rc_log enable row level security;
revoke all on public.rc_log from anon, authenticated;
revoke all on sequence public.rc_log_id_seq from anon, authenticated;
create index if not exists rc_log_at on public.rc_log (at);

create or replace function public.rc_apply(ev jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
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
  -- journal anonyme (compté une seule fois par message, même si RevenueCat le renvoie) ; ne bloque jamais la mise à jour du statut
  if typ in ('INITIAL_PURCHASE', 'RENEWAL', 'NON_RENEWING_PURCHASE', 'PRODUCT_CHANGE', 'CANCELLATION', 'UNCANCELLATION', 'EXPIRATION') then
    begin
      insert into public.rc_log (event_id, at, type, kind, lifetime, store, env, period_type, trial_conversion, cancel_reason, amount, currency)
      values (left(nullif(ev ->> 'id', ''), 100), ts, typ, kind, life, left(ev ->> 'store', 30), left(upper(coalesce(nullif(ev ->> 'environment', ''), 'PRODUCTION')), 20),
        left(upper(ev ->> 'period_type'), 20), coalesce((ev ->> 'is_trial_conversion')::boolean, false), left(upper(ev ->> 'cancel_reason'), 40),
        round((ev ->> 'price_in_purchased_currency')::numeric, 2), left(upper(ev ->> 'currency'), 3))
      on conflict (event_id) do nothing;
    exception when others then null;
    end;
  end if;
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

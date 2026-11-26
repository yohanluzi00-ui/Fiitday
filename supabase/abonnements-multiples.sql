-- ⚠ HISTORIQUE — NE PAS RELANCER. Ce fichier a déjà été appliqué ; la base a évolué depuis (abonnement, Premium,
-- verrous de la version gratuite). Le relancer remplacerait des protections actuelles par d'anciennes versions.
-- Référence : l'historique des migrations de Supabase (Database › Migrations) et supabase/migrations/ ; voir supabase/LISEZMOI.md.
-- Abonnements multiples (24/11/2026) : chaque abonnement est suivi à part (une boutique + un produit),
-- et Premium vient du meilleur abonnement encore actif. Avant, le dernier message de RevenueCat écrasait le précédent :
-- quelqu'un qui avait deux abonnements (par carte et Google Play, ou Solo puis Famille) pouvait perdre Premium à tort
-- quand l'un des deux se terminait.

create table if not exists public.rc_subs (
  user_id uuid not null references auth.users(id) on delete cascade,
  store text not null check (char_length(store) between 1 and 30),
  product text not null check (char_length(product) between 1 and 100),
  kind text not null check (kind in ('solo', 'family')),
  until timestamptz,
  renews boolean,
  event_at timestamptz not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, store, product)
);
alter table public.rc_subs enable row level security; -- aucune règle : lu et écrit seulement par les fonctions du serveur
revoke all on public.rc_subs from anon, authenticated;

-- reprise de l'abonnement déjà connu (un seul par compte avant cette correction)
insert into public.rc_subs (user_id, store, product, kind, until, renews, event_at)
select e.user_id, coalesce(nullif(e.sub_store, ''), 'INCONNU'), 'avant-24-11-2026', e.sub_kind, e.sub_until, e.sub_renews, coalesce(e.rc_event_at, e.updated_at, now())
from public.entitlements e where e.sub_kind is not null
on conflict do nothing;

CREATE OR REPLACE FUNCTION public.rc_apply(ev jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  uid uuid;
  typ text := upper(coalesce(ev ->> 'type', ''));
  v_product text := coalesce(nullif(ev ->> 'new_product_id', ''), ev ->> 'product_id', '');
  env text := upper(coalesce(nullif(ev ->> 'environment', ''), 'PRODUCTION'));
  st text := left(upper(coalesce(nullif(ev ->> 'store', ''), 'INCONNU')), 30);
  -- seul compte qui reçoit Premium avec un achat de test (magasin de test RevenueCat, testeurs Google, mode test Stripe)
  tester constant uuid := '8d8a867f-e766-41ca-b197-7694f5f5e1c4';
  v_kind text;
  life boolean;
  ts timestamptz;
  exp timestamptz;
  last_ts timestamptz;
  old_until timestamptz;
  new_until timestamptz;
  new_renews boolean;
  b record;
begin
  begin uid := (ev ->> 'app_user_id')::uuid; exception when others then uid := null; end;
  if uid is null then begin uid := (ev ->> 'original_app_user_id')::uuid; exception when others then uid := null; end; end if;
  if uid is null or not exists (select 1 from auth.users where id = uid) then return jsonb_build_object('applied', false, 'reason', 'compte inconnu'); end if;
  -- sans ce contrôle, n'importe qui ayant une appli de test pourrait s'offrir Premium avec un faux achat
  if env <> 'PRODUCTION' and uid <> tester then return jsonb_build_object('applied', false, 'reason', 'achat de test ignoré'); end if;
  ts := to_timestamp(coalesce((ev ->> 'event_timestamp_ms')::bigint, (extract(epoch from now()) * 1000)::bigint) / 1000.0);
  if ev ->> 'expiration_at_ms' is not null then exp := to_timestamp((ev ->> 'expiration_at_ms')::bigint / 1000.0); end if;
  v_kind := case when v_product ~* 'famil' then 'family' else 'solo' end;
  life := v_product ~* '(life|vie)';
  -- journal anonyme (compté une seule fois par message, même si RevenueCat le renvoie) ; ne bloque jamais la mise à jour du statut
  if typ in ('INITIAL_PURCHASE', 'RENEWAL', 'NON_RENEWING_PURCHASE', 'PRODUCT_CHANGE', 'CANCELLATION', 'UNCANCELLATION', 'EXPIRATION') then
    begin
      insert into public.rc_log (event_id, at, type, kind, lifetime, store, env, period_type, trial_conversion, cancel_reason, amount, currency)
      values (left(nullif(ev ->> 'id', ''), 100), ts, typ, v_kind, life, left(ev ->> 'store', 30), left(env, 20),
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
      update public.entitlements set lifetime_kind = case when v_kind = 'family' or lifetime_kind = 'family' then 'family' else 'solo' end, life_event_at = ts, updated_at = now() where user_id = uid;
    end if;
  else
    -- abonnements : chacun (boutique + produit) a sa propre horloge et sa propre date de fin
    if v_product = '' then return jsonb_build_object('applied', false, 'reason', 'produit inconnu'); end if;
    select s.event_at, s.until into last_ts, old_until from public.rc_subs s where s.user_id = uid and s.store = st and s.product = left(v_product, 100);
    if last_ts is not null and ts < last_ts then return jsonb_build_object('applied', false, 'reason', 'message plus ancien que le dernier appliqué'); end if;
    if typ not in ('INITIAL_PURCHASE', 'RENEWAL', 'PRODUCT_CHANGE', 'UNCANCELLATION', 'SUBSCRIPTION_EXTENDED', 'TEMPORARY_ENTITLEMENT_GRANT', 'CANCELLATION', 'EXPIRATION') then
      return jsonb_build_object('applied', false, 'reason', 'type ignoré : ' || typ);
    end if;
    if typ = 'CANCELLATION' then
      -- résilié : reste Premium jusqu'à la fin de la période payée (ou fin immédiate si remboursé)
      new_until := case when ev ->> 'cancel_reason' = 'CUSTOMER_SUPPORT' and exp is not null then least(coalesce(old_until, exp), exp) else coalesce(old_until, exp) end;
      new_renews := false;
    elsif typ = 'EXPIRATION' then
      new_until := least(coalesce(old_until, exp, now()), now());
      new_renews := false;
    else
      new_until := coalesce(exp, old_until);
      new_renews := typ <> 'TEMPORARY_ENTITLEMENT_GRANT';
    end if;
    insert into public.rc_subs as s (user_id, store, product, kind, until, renews, event_at)
    values (uid, st, left(v_product, 100), v_kind, new_until, new_renews, ts)
    on conflict (user_id, store, product) do update set kind = excluded.kind, until = excluded.until, renews = excluded.renews, event_at = excluded.event_at, updated_at = now();
    -- changement de formule (ex. Solo → Famille dans Google Play) : l'ancien produit ne se renouvelle plus
    if typ = 'PRODUCT_CHANGE' and coalesce(ev ->> 'product_id', '') not in ('', v_product) then
      update public.rc_subs set renews = false, updated_at = now() where user_id = uid and store = st and product = left(ev ->> 'product_id', 100);
    end if;
    -- résumé dans entitlements (administration) : le meilleur abonnement, actif d'abord, Famille d'abord, puis celui qui se renouvelle
    select s.kind, s.until, s.store, s.renews into b from public.rc_subs s where s.user_id = uid
      order by (s.until is not null and s.until > now()) desc, (s.kind = 'family') desc, s.renews desc nulls last, s.until desc nulls last limit 1;
    insert into public.entitlements (user_id) values (uid) on conflict (user_id) do nothing;
    update public.entitlements set sub_kind = b.kind, sub_until = b.until, sub_store = b.store, sub_renews = b.renews,
      rc_event_at = greatest(coalesce(rc_event_at, ts), ts), updated_at = now() where user_id = uid;
  end if;
  return jsonb_build_object('applied', true, 'type', typ, 'kind', v_kind, 'lifetime', life);
end $function$;
revoke all on function public.rc_apply(jsonb) from public, anon, authenticated;
grant execute on function public.rc_apply(jsonb) to service_role;

-- droits, statut affiché et chiffres de l'administration : lus dans les abonnements suivis un par un
do $$
declare d text; n text;
begin
  d := pg_get_functiondef('public.own_rights(uuid, timestamptz)'::regprocedure);
  n := replace(d, $o$select e.sub_kind, 'subscription', e.sub_until, 2 from public.entitlements e where e.user_id = uid and e.sub_kind is not null and e.sub_until > at_ts$o$,
                  $n$select s.kind, 'subscription', s.until, 2 from public.rc_subs s where s.user_id = uid and s.until > at_ts$n$);
  if n = d then raise exception 'own_rights : passage à remplacer introuvable'; end if;
  execute n;

  d := pg_get_functiondef('public.plan_info(uuid)'::regprocedure);
  n := replace(replace(d,
    $o$'renews', (select e.sub_renews from public.entitlements e where e.user_id = uid and o_source = 'subscription'),$o$,
    $n$'renews', (select s.renews from public.rc_subs s where s.user_id = uid and o_source = 'subscription' and s.until = o_until and s.kind = o_kind order by s.renews desc nulls last limit 1),$n$),
    $o$'store', (select e.sub_store from public.entitlements e where e.user_id = uid and o_source = 'subscription'),$o$,
    $n$'store', (select s.store from public.rc_subs s where s.user_id = uid and o_source = 'subscription' and s.until = o_until and s.kind = o_kind order by s.renews desc nulls last limit 1),$n$);
  if n = d or position('rc_subs' in n) = 0 or position('e.sub_store' in n) > 0 or position('e.sub_renews' in n) > 0 then raise exception 'plan_info : passages à remplacer introuvables'; end if;
  execute n;

  d := pg_get_functiondef('public.admin_subs()'::regprocedure);
  n := replace(replace(d,
    $o$'subscribers', (select count(*) from public.entitlements e where e.sub_kind is not null and e.sub_until > now()),$o$,
    $n$'subscribers', (select count(distinct s.user_id) from public.rc_subs s where s.until > now()),$n$),
    $o$'cancelled', (select count(*) from public.entitlements e where e.sub_kind is not null and e.sub_until > now() and e.sub_renews is false),$o$,
    $n$'cancelled', (select count(*) from (select s.user_id from public.rc_subs s where s.until > now() group by s.user_id having not bool_or(coalesce(s.renews, false))) x),$n$);
  if n = d or position('e.sub_until' in n) > 0 then raise exception 'admin_subs : passages à remplacer introuvables'; end if;
  execute n;
end $$;

-- Lot 4 de l'audit : rétractation (jours fériés, réabonnement), prix datés, achats à vie séparés, messages RevenueCat traités
-- une seule fois, journal des confirmations de commande, alertes de l'Administration, semaines à l'heure de Paris, e-mails normalisés

-- 1) jours fériés français et fin du délai de rétractation (L221-19 : prorogé au premier jour ouvrable)
create or replace function public.paques(y int) returns date language plpgsql immutable set search_path = '' as $$
declare a int := y % 19; b int := y / 100; c int := y % 100; d int; e int; f int; g int; h int; i int; k int; l int; m int; n int;
begin
  d := b / 4; e := b % 4; f := (b + 8) / 25; g := (b - f + 1) / 3; h := (19 * a + b - d - g + 15) % 30;
  i := c / 4; k := c % 4; l := (32 + 2 * e + 2 * i - h - k) % 7; m := (a + 11 * h + 22 * l) / 451; n := h + l - 7 * m + 114;
  return make_date(y, n / 31, n % 31 + 1);
end $$;
create or replace function public.jour_ferie(d date) returns boolean language sql immutable set search_path = '' as $$
  select to_char(d, 'MM-DD') in ('01-01', '05-01', '05-08', '07-14', '08-15', '11-01', '11-11', '12-25')
    or d in (public.paques(extract(year from d)::int) + 1, public.paques(extract(year from d)::int) + 39, public.paques(extract(year from d)::int) + 50)
$$;
create or replace function public.retract_until(p_at timestamptz) returns timestamptz language plpgsql stable set search_path = '' as $$
declare d date := (p_at at time zone 'Europe/Paris')::date + 14; -- dernier jour inclus
begin
  while extract(isodow from d) in (6, 7) or public.jour_ferie(d) loop d := d + 1; end loop;
  return ((d + 1)::timestamp) at time zone 'Europe/Paris'; -- fin à minuit, heure de Paris
end $$;

-- 2) prix datés : Premium à vie passe à 79,90 € / 229,90 € le 1er janvier 2028 (le montant affiché suit la date d'achat)
drop function if exists public.fiitday_price(text);
create or replace function public.fiitday_price(p_product text, p_at timestamptz default now())
returns table(amount numeric, months integer, label text) language sql stable set search_path = '' as $$
  select case when v.product ~ '_vie_' and p_at >= timestamptz '2028-01-01 00:00 Europe/Paris' then v.after else v.amount end, v.months, v.label from (values
    ('fiitday_solo_annuel', 19.90, 19.90, 12, 'Premium Solo annuel'), ('fiitday_solo_mensuel', 1.99, 1.99, 1, 'Premium Solo mensuel'),
    ('fiitday_famille_annuel', 69.90, 69.90, 12, 'Premium Famille annuel'), ('fiitday_famille_mensuel', 6.99, 6.99, 1, 'Premium Famille mensuel'),
    ('fiitday_vie_solo', 49.90, 79.90, 0, 'Premium Solo à vie'), ('fiitday_vie_famille', 149.90, 229.90, 0, 'Premium Famille à vie')) as v(product, amount, after, months, label)
  where v.product = p_product
$$;
revoke all on function public.fiitday_price(text, timestamptz) from public, anon, authenticated;

-- 3) achats à vie : Solo et Famille suivis chacun à part (le remboursement de l'un n'efface plus l'autre)
alter table public.entitlements add column if not exists life_solo_at timestamptz, add column if not exists life_family_at timestamptz;
update public.entitlements set life_solo_at = life_event_at where lifetime_kind = 'solo' and life_solo_at is null;
update public.entitlements set life_family_at = life_event_at where lifetime_kind = 'family' and life_family_at is null;

-- 4) messages RevenueCat déjà traités (RevenueCat renvoie un message si la réponse tarde) : ignorés la 2e fois
create table if not exists public.rc_seen (event_id text primary key, at timestamptz not null default now());
alter table public.rc_seen enable row level security;
revoke all on public.rc_seen from anon, authenticated;

-- 5) confirmations de commande (L221-13) : journal, nouvelle tentative chaque jour si l'envoi a échoué
create table if not exists public.order_confirmations (
  event_id text primary key,
  user_id uuid references auth.users(id) on delete set null,
  product text not null, store text not null, env text not null,
  bought_at timestamptz not null,
  created_at timestamptz not null default now(),
  status text not null default 'à envoyer', tries int not null default 0, sent_at timestamptz, cgv text not null default '');
alter table public.order_confirmations enable row level security;
revoke all on public.order_confirmations from anon, authenticated;

-- 6) rc_apply : nouveau contrat (premier achat, achat à vie, changement de formule, réabonnement après la fin) = nouveau délai
--    de rétractation et confirmation de commande ; achats à vie par produit ; message déjà traité ignoré
create or replace function public.rc_apply(ev jsonb)
 returns jsonb language plpgsql security definer set search_path to ''
as $function$
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
  old_renews boolean;
  new_until timestamptz;
  new_renews boolean;
  new_contract boolean := false;
  b record;
begin
  begin uid := (ev ->> 'app_user_id')::uuid; exception when others then uid := null; end;
  if uid is null then begin uid := (ev ->> 'original_app_user_id')::uuid; exception when others then uid := null; end; end if;
  if uid is null or not exists (select 1 from auth.users where id = uid) then return jsonb_build_object('applied', false, 'reason', 'compte inconnu'); end if;
  -- sans ce contrôle, n'importe qui ayant une appli de test pourrait s'offrir Premium avec un faux achat
  if env <> 'PRODUCTION' and (uid <> tester or (typ in ('INITIAL_PURCHASE', 'NON_RENEWING_PURCHASE')
       and coalesce((select c.test_purchases_until from public.app_config c where c.id), '-infinity'::timestamptz) < now())) then
    return jsonb_build_object('applied', false, 'reason', 'achat de test ignoré'); end if;
  -- même message reçu deux fois (RevenueCat renvoie quand la réponse tarde) : appliqué une seule fois
  if nullif(ev ->> 'id', '') is not null then
    insert into public.rc_seen (event_id) values (left(ev ->> 'id', 100)) on conflict (event_id) do nothing;
    if not found then return jsonb_build_object('applied', false, 'reason', 'message déjà traité'); end if;
  end if;
  ts := to_timestamp(coalesce((ev ->> 'event_timestamp_ms')::bigint, (extract(epoch from now()) * 1000)::bigint) / 1000.0);
  if ev ->> 'expiration_at_ms' is not null then exp := to_timestamp((ev ->> 'expiration_at_ms')::bigint / 1000.0); end if;
  v_kind := case when v_product ~* 'famil' then 'family' else 'solo' end;
  life := v_product ~* '(life|vie)';
  -- journal anonyme (compté une seule fois par message) ; ne bloque jamais la mise à jour du statut
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
      -- remboursement d'un achat à vie : seulement celui-ci (l'autre achat à vie éventuel reste)
      update public.entitlements set life_solo_at = case when v_kind = 'solo' then null else life_solo_at end,
        life_family_at = case when v_kind = 'family' then null else life_family_at end, life_event_at = ts, updated_at = now() where user_id = uid;
    else
      update public.entitlements set life_solo_at = case when v_kind = 'solo' then ts else life_solo_at end,
        life_family_at = case when v_kind = 'family' then ts else life_family_at end, life_event_at = ts, life_store = st, updated_at = now() where user_id = uid;
      new_contract := true;
    end if;
    update public.entitlements set lifetime_kind = case when life_family_at is not null then 'family' when life_solo_at is not null then 'solo' end where user_id = uid;
  else
    -- abonnements : chacun (boutique + produit) a sa propre horloge et sa propre date de fin
    if v_product = '' then return jsonb_build_object('applied', false, 'reason', 'produit inconnu'); end if;
    select s.event_at, s.until, s.renews into last_ts, old_until, old_renews from public.rc_subs s where s.user_id = uid and s.store = st and s.product = left(v_product, 100);
    if last_ts is not null and ts < last_ts then return jsonb_build_object('applied', false, 'reason', 'message plus ancien que le dernier appliqué'); end if;
    if typ not in ('INITIAL_PURCHASE', 'RENEWAL', 'PRODUCT_CHANGE', 'UNCANCELLATION', 'SUBSCRIPTION_EXTENDED', 'TEMPORARY_ENTITLEMENT_GRANT', 'CANCELLATION', 'EXPIRATION') then
      return jsonb_build_object('applied', false, 'reason', 'type ignoré : ' || typ);
    end if;
    -- nouveau contrat : premier achat, changement de formule, ou réabonnement après la fin (abonnement arrêté et expiré)
    new_contract := typ in ('INITIAL_PURCHASE', 'PRODUCT_CHANGE') or (typ = 'RENEWAL' and old_renews is false and old_until is not null and old_until <= ts);
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
    insert into public.rc_subs as s (user_id, store, product, kind, until, renews, event_at, first_at)
    values (uid, st, left(v_product, 100), v_kind, new_until, new_renews, ts, ts)
    on conflict (user_id, store, product) do update set kind = excluded.kind, until = excluded.until, renews = excluded.renews, event_at = excluded.event_at, updated_at = now(),
      first_at = case when new_contract then ts else coalesce(s.first_at, ts) end;
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
  return jsonb_build_object('applied', true, 'type', typ, 'kind', v_kind, 'lifetime', life, 'user_id', uid, 'product', v_product, 'store', st, 'env', env,
      'new_contract', new_contract, 'at', ts,
      'until', case when life then null else (select s.until from public.rc_subs s where s.user_id = uid and s.store = st and s.product = left(v_product, 100)) end);
end $function$;

-- 7) résiliation / rétractation : achats à vie par produit, montant au prix de la date d'achat
create or replace function public.contract_check(p_user uuid, p_kind text, p_store text, p_product text, p_wish text)
 returns jsonb language plpgsql security definer set search_path to ''
as $function$
declare s public.rc_subs; e public.entitlements; pr record; start_at timestamptz; v_end timestamptz; v_refund numeric := 0; v_life timestamptz;
begin
  select * into pr from public.fiitday_price(p_product);
  if pr is null then return jsonb_build_object('ok', false, 'reason', 'Produit inconnu'); end if;
  if p_product ~ '_vie_' then
    select * into e from public.entitlements where user_id = p_user;
    if p_kind <> 'retractation' then return jsonb_build_object('ok', false, 'reason', 'Un achat à vie ne se résilie pas'); end if;
    v_life := case when p_product = 'fiitday_vie_famille' then e.life_family_at else e.life_solo_at end;
    if v_life is null then return jsonb_build_object('ok', false, 'reason', 'Achat introuvable'); end if;
    if now() > public.retract_until(v_life) then return jsonb_build_object('ok', false, 'reason', 'Le délai de 14 jours est dépassé'); end if;
    select * into pr from public.fiitday_price(p_product, v_life);
    return jsonb_build_object('ok', true, 'label', pr.label, 'end_at', now(), 'refund', pr.amount, 'refund_all', true, 'lifetime', true, 'at', v_life);
  end if;
  select * into s from public.rc_subs where user_id = p_user and store = p_store and product = p_product;
  if s.user_id is null or s.until <= now() then return jsonb_build_object('ok', false, 'reason', 'Abonnement introuvable ou déjà terminé'); end if;
  if p_kind = 'retractation' then
    if now() > public.retract_until(coalesce(s.first_at, s.event_at)) then return jsonb_build_object('ok', false, 'reason', 'Le délai de 14 jours est dépassé'); end if;
    return jsonb_build_object('ok', true, 'label', pr.label, 'end_at', now(), 'refund', pr.amount, 'refund_all', true, 'until', s.until, 'renews', s.renews, 'at', s.first_at);
  elsif p_kind = 'resiliation' then
    if p_wish = 'maintenant' then
      start_at := s.until - make_interval(months => pr.months);
      v_end := now();
      v_refund := greatest(round(pr.amount * extract(epoch from (s.until - v_end)) / nullif(extract(epoch from (s.until - start_at)), 0), 2), 0);
      v_refund := least(v_refund, pr.amount);
    elsif p_wish = 'fin' then
      if s.renews is false then return jsonb_build_object('ok', false, 'reason', 'Cet abonnement est déjà résilié : il s''arrête le ' || to_char(s.until at time zone 'Europe/Paris', 'DD/MM/YYYY')); end if;
      v_end := s.until;
    else
      return jsonb_build_object('ok', false, 'reason', 'Date de fin à choisir');
    end if;
    return jsonb_build_object('ok', true, 'label', pr.label, 'end_at', v_end, 'refund', v_refund, 'refund_all', false, 'until', s.until, 'renews', s.renews);
  end if;
  return jsonb_build_object('ok', false, 'reason', 'Demande inconnue');
end $function$;

create or replace function public.contract_save(p_user uuid, p_kind text, p_store text, p_product text, p_wish text, p_name text, p_email text, p_auto text)
 returns jsonb language plpgsql security definer set search_path to ''
as $function$
declare c jsonb; r public.contract_requests; b record;
begin
  c := public.contract_check(p_user, p_kind, p_store, p_product, p_wish);
  if not coalesce((c ->> 'ok')::boolean, false) then return c; end if;
  insert into public.contract_requests (user_id, kind, store, product, label, name, email, wish, end_at, refund, refund_all, auto)
  values (p_user, p_kind, p_store, p_product, c ->> 'label', left(trim(p_name), 120), left(trim(p_email), 200), case when p_kind = 'resiliation' then p_wish end,
    (c ->> 'end_at')::timestamptz, (c ->> 'refund')::numeric, coalesce((c ->> 'refund_all')::boolean, false), left(coalesce(p_auto, ''), 300))
  returning * into r;
  if p_product ~ '_vie_' then
    update public.entitlements set life_solo_at = case when p_product = 'fiitday_vie_solo' then null else life_solo_at end,
      life_family_at = case when p_product = 'fiitday_vie_famille' then null else life_family_at end, updated_at = now() where user_id = p_user;
    update public.entitlements set lifetime_kind = case when life_family_at is not null then 'family' when life_solo_at is not null then 'solo' end where user_id = p_user;
  else
    update public.rc_subs set renews = false, until = least(until, r.end_at), updated_at = now() where user_id = p_user and store = p_store and product = p_product;
    select s.kind, s.until, s.store, s.renews into b from public.rc_subs s where s.user_id = p_user
      order by (s.until is not null and s.until > now()) desc, (s.kind = 'family') desc, s.renews desc nulls last, s.until desc nulls last limit 1;
    update public.entitlements set sub_kind = b.kind, sub_until = b.until, sub_store = b.store, sub_renews = b.renews, updated_at = now() where user_id = p_user;
  end if;
  -- rétractations de ce compte (ou de cette adresse e-mail) : pour l'alerte « rétractations répétées »
  return jsonb_build_object('ok', true, 'id', r.id, 'label', r.label, 'end_at', r.end_at, 'refund', r.refund, 'refund_all', r.refund_all, 'at', r.created_at,
    'retractations', case when p_kind = 'retractation' then (select count(*) from public.contract_requests q where q.kind = 'retractation' and (q.user_id = p_user or lower(q.email) = lower(trim(p_email)))) else 0 end);
end $function$;

create or replace function public.my_contracts()
 returns jsonb language plpgsql security definer set search_path to ''
as $function$
declare uid uuid := auth.uid(); e public.entitlements;
begin
  if uid is null then return jsonb_build_object('ok', false); end if;
  select * into e from public.entitlements where user_id = uid;
  return jsonb_build_object('ok', true, 'now', now(),
    'subs', coalesce((select jsonb_agg(jsonb_build_object('store', s.store, 'product', s.product, 'kind', s.kind, 'until', s.until, 'renews', s.renews,
        'first_at', s.first_at, 'retract_until', public.retract_until(coalesce(s.first_at, s.event_at)),
        'label', coalesce((select p.label from public.fiitday_price(s.product) p), s.product)) order by s.until desc)
      from public.rc_subs s where s.user_id = uid and s.product ~ '^fiitday_' and s.until > now()), '[]'::jsonb),
    -- achats à vie : chacun à part ; « life » (le plus large) reste pour les anciennes versions de l'appli
    'life', case when e.lifetime_kind is null then null else jsonb_build_object('kind', e.lifetime_kind, 'at', coalesce(case when e.lifetime_kind = 'family' then e.life_family_at else e.life_solo_at end, e.life_event_at),
      'store', coalesce(e.life_store, 'INCONNU'), 'retract_until', public.retract_until(coalesce(case when e.lifetime_kind = 'family' then e.life_family_at else e.life_solo_at end, e.life_event_at)),
      'product', case when e.lifetime_kind = 'family' then 'fiitday_vie_famille' else 'fiitday_vie_solo' end) end,
    'lifes', (select coalesce(jsonb_agg(x.j), '[]'::jsonb) from (
        select jsonb_build_object('kind', 'family', 'at', e.life_family_at, 'store', coalesce(e.life_store, 'INCONNU'), 'retract_until', public.retract_until(e.life_family_at), 'product', 'fiitday_vie_famille') j where e.life_family_at is not null
        union all
        select jsonb_build_object('kind', 'solo', 'at', e.life_solo_at, 'store', coalesce(e.life_store, 'INCONNU'), 'retract_until', public.retract_until(e.life_solo_at), 'product', 'fiitday_vie_solo') where e.life_solo_at is not null) x),
    'requests', coalesce((select jsonb_agg(jsonb_build_object('kind', r.kind, 'product', r.product, 'label', r.label, 'at', r.created_at, 'end_at', r.end_at,
        'refund', r.refund, 'refund_all', r.refund_all) order by r.created_at desc) from public.contract_requests r where r.user_id = uid and r.created_at > now() - interval '400 days'), '[]'::jsonb));
end $function$;

-- 8) e-mail normalisé pour l'essai unique (« prenom+1@… », points de Gmail) ; les anciennes empreintes restent reconnues
create or replace function public.email_norm(e text) returns text language sql immutable set search_path = '' as $$
  select case when position('@' in x) = 0 then x else
    (case when split_part(x, '@', 2) in ('gmail.com', 'googlemail.com') then replace(split_part(split_part(x, '@', 1), '+', 1), '.', '') else split_part(split_part(x, '@', 1), '+', 1) end)
    || '@' || case when split_part(x, '@', 2) = 'googlemail.com' then 'gmail.com' else split_part(x, '@', 2) end end
  from (select lower(btrim(coalesce(e, ''))) as x) s
$$;
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
    insert into public.trial_used (email_hash) values (public.email_hash(em)), (public.email_hash(public.email_norm(em))) on conflict (email_hash) do nothing;
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

-- 9) plan_info : e-mail normalisé pour l'essai, et « can_buy » (ventes ouvertes, décidé par le serveur) ;
--    admin_kpis / admin_subs : semaines coupées le lundi à 0 h, heure de Paris ; admin_subs : même essai normalisé
do $$
declare def text;
begin
  def := pg_get_functiondef('public.plan_info(uuid)'::regprocedure);
  def := replace(def, 'where t.email_hash = public.email_hash(u_email) and', 'where t.email_hash in (public.email_hash(u_email), public.email_hash(public.email_norm(u_email))) and');
  def := replace(def, '''launched'', live, ''launch_at'', launch,', '''launched'', live, ''can_buy'', live, ''launch_at'', launch,');
  if position('can_buy' in def) = 0 or position('email_norm' in def) = 0 then raise exception 'plan_info : remplacement impossible'; end if;
  execute def;
  def := pg_get_functiondef('public.admin_kpis()'::regprocedure);
  def := replace(def, 'date_trunc(''week'', now())', '(date_trunc(''week'', now() at time zone ''Europe/Paris'') at time zone ''Europe/Paris'')');
  def := replace(def, 'to_char(wk, ''YYYY-MM-DD'')', 'to_char(wk at time zone ''Europe/Paris'', ''YYYY-MM-DD'')');
  if position('Europe/Paris' in def) = 0 then raise exception 'admin_kpis : remplacement impossible'; end if;
  execute def;
  def := pg_get_functiondef('public.admin_subs()'::regprocedure);
  def := replace(def, 'date_trunc(''week'', now())', '(date_trunc(''week'', now() at time zone ''Europe/Paris'') at time zone ''Europe/Paris'')');
  def := replace(def, 't.email_hash = public.email_hash(au.email)', 't.email_hash in (public.email_hash(au.email), public.email_hash(public.email_norm(au.email)))');
  if position('Europe/Paris' in def) = 0 or position('email_norm' in def) = 0 then raise exception 'admin_subs : remplacement impossible'; end if;
  execute def;
end $$;

-- 10) Administration › Abonnements : date limite des remboursements à faire, rétractations répétées, confirmations non
--     envoyées et clients RevenueCat encore à effacer
create or replace function public.admin_contracts()
 returns jsonb language plpgsql security definer set search_path to 'public', 'pg_temp'
as $function$
begin
  if not public.admin_ok() then return public.admin_denied(); end if;
  return jsonb_build_object(
    'requests', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'kind', r.kind, 'store', r.store, 'product', r.product, 'label', r.label, 'name', r.name,
        'email', r.email, 'wish', r.wish, 'end_at', r.end_at, 'refund', r.refund, 'refund_all', r.refund_all, 'auto', r.auto, 'mail', r.mail,
        'at', r.created_at, 'done_at', r.done_at, 'deadline', r.created_at + interval '14 days',
        'repeat', case when r.kind = 'retractation' then (select count(*) from public.contract_requests q where q.kind = 'retractation' and (q.user_id = r.user_id or lower(q.email) = lower(r.email))) else 0 end
        ) order by r.created_at desc) from (select * from public.contract_requests order by created_at desc limit 60) r), '[]'::jsonb),
    'reminders', (select count(*) from public.renewal_reminders where sent_at > now() - interval '30 days'),
    'conf_fail', (select count(*) from public.order_confirmations where status not like 'envoyé%' and created_at > now() - interval '30 days'),
    'rc_pending', (select count(*) from public.rc_pending_delete),
    'at', now());
end $function$;

-- 11) purges : messages RevenueCat déjà vus (90 jours), journal des confirmations (5 ans, preuve d'envoi)
create or replace function public.daily_purge()
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare a int; b int; c int; d int; e int; f int; g int;
begin
  delete from public.contract_requests where coalesce(end_at, created_at) < now() - interval '5 years'; get diagnostics a = row_count;
  delete from public.purchase_consents where user_id is null and at < now() - interval '5 years'; get diagnostics b = row_count;
  delete from auth.users where email_confirmed_at is null and created_at < now() - interval '30 days'; get diagnostics c = row_count;
  delete from public.trial_used where at < now() - interval '3 years'; get diagnostics d = row_count;
  delete from public.family_log where at < now() - interval '12 months'; get diagnostics e = row_count;
  delete from public.rc_seen where at < now() - interval '90 days'; get diagnostics f = row_count;
  delete from public.order_confirmations where created_at < now() - interval '5 years'; get diagnostics g = row_count;
  return jsonb_build_object('demandes', a, 'accords', b, 'comptes_non_verifies', c, 'empreintes', d, 'journal_familles', e, 'messages_rc', f, 'confirmations', g, 'at', now());
end $$;
revoke all on function public.daily_purge() from public, anon, authenticated;

-- 12) nouvelle tentative quotidienne des confirmations de commande non envoyées (fonction revenuecat, même secret que les rappels)
do $$ begin
  if not exists (select 1 from cron.job where jobname = 'fiitday-relance-confirmations') then
    perform cron.schedule('fiitday-relance-confirmations', '23 9 * * *', $c$
  select net.http_post(url := 'https://krszgabjpswqjtypalsn.supabase.co/functions/v1/revenuecat',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'fiitday_cron_secret')),
    body := '{"action":"relance"}'::jsonb)
$c$);
  end if;
end $$;

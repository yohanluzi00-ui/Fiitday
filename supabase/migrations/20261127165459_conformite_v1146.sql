-- V1.146 : conformité avant l'ouverture des ventes (décisions du 27 novembre 2026)
-- 1. Code de transfert supprimé : la sauvegarde en fichier (Réglages › Données) le remplace.
-- 2. Rétractation : les jours déjà utilisés sont payés au prorata (Code de la consommation, L221-25), le reste est
--    remboursé ; abonnements : au prorata de la période payée ; Premium à vie : sur une durée de référence de 3 ans.
-- 3. Factures et avoirs numérotés sans trou, une facture par paiement par carte (fiitday.com).
-- 4. Registre des recettes : une ligne par paiement et une par remboursement (plus de regroupement par mois).
-- 5. Comptes inactifs : prévenus par e-mail, puis supprimés après 2 ans sans utilisation (sauf Premium payé ou offert).

/* ---------- 1. code de transfert ---------- */
drop function if exists public.create_transfer(text);
drop function if exists public.use_transfer(text);
drop table if exists public.transfer_tries;
drop table if exists public.transfers;

/* ---------- 2. rétractation au prorata ---------- */
create or replace function public.contract_check(p_user uuid, p_kind text, p_store text, p_product text, p_wish text)
 returns jsonb language plpgsql security definer set search_path to ''
as $function$
declare s public.rc_subs; e public.entitlements; pr record; start_at timestamptz; v_at timestamptz; v_end timestamptz;
  v_refund numeric := 0; v_total numeric; v_used numeric;
begin
  select * into pr from public.fiitday_price(p_product);
  if pr is null then return jsonb_build_object('ok', false, 'reason', 'Produit inconnu'); end if;
  if p_product ~ '_vie_' then
    -- achat à vie : seulement la rétractation, pendant 14 jours
    select * into e from public.entitlements where user_id = p_user;
    if p_kind <> 'retractation' then return jsonb_build_object('ok', false, 'reason', 'Un achat à vie ne se résilie pas'); end if;
    v_at := case when p_product = 'fiitday_vie_famille' then e.life_family_at else e.life_solo_at end;
    if v_at is null then return jsonb_build_object('ok', false, 'reason', 'Achat introuvable'); end if;
    if now() > public.retract_until(v_at) then return jsonb_build_object('ok', false, 'reason', 'Le délai de 14 jours est dépassé'); end if;
    select * into pr from public.fiitday_price(p_product, v_at); -- prix payé (prix de lancement ou prix normal)
    -- jours utilisés payés au prorata d'une durée de référence de 3 ans (la même que la garantie des CGV en cas d'arrêt)
    v_total := extract(epoch from (v_at + interval '3 years') - v_at);
    v_used := greatest(extract(epoch from now() - v_at), 0);
    v_refund := greatest(least(round(pr.amount * (1 - v_used / v_total), 2), pr.amount), 0);
    return jsonb_build_object('ok', true, 'label', pr.label, 'end_at', now(), 'refund', v_refund, 'refund_all', v_refund >= pr.amount,
      'price', pr.amount, 'kept', pr.amount - v_refund, 'lifetime', true, 'at', v_at);
  end if;
  select * into s from public.rc_subs where user_id = p_user and store = p_store and product = p_product;
  if s.user_id is null or s.until <= now() then return jsonb_build_object('ok', false, 'reason', 'Abonnement introuvable ou déjà terminé'); end if;
  if p_kind = 'retractation' then
    start_at := coalesce(s.first_at, s.event_at);
    if now() > public.retract_until(start_at) then return jsonb_build_object('ok', false, 'reason', 'Le délai de 14 jours est dépassé'); end if;
    -- jours utilisés payés au prorata de la période payée (un mois ou un an)
    v_total := extract(epoch from (start_at + make_interval(months => greatest(pr.months, 1))) - start_at);
    v_used := greatest(extract(epoch from now() - start_at), 0);
    v_refund := greatest(least(round(pr.amount * (1 - v_used / v_total), 2), pr.amount), 0);
    return jsonb_build_object('ok', true, 'label', pr.label, 'end_at', now(), 'refund', v_refund, 'refund_all', v_refund >= pr.amount,
      'price', pr.amount, 'kept', pr.amount - v_refund, 'until', s.until, 'renews', s.renews, 'at', start_at);
  elsif p_kind = 'resiliation' then
    if p_wish = 'maintenant' then
      -- fin tout de suite : la part de la période payée et non utilisée est remboursée
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
    return jsonb_build_object('ok', true, 'label', pr.label, 'end_at', v_end, 'refund', v_refund, 'refund_all', false, 'price', pr.amount,
      'until', s.until, 'renews', s.renews);
  end if;
  return jsonb_build_object('ok', false, 'reason', 'Demande inconnue');
end $function$;
revoke all on function public.contract_check(uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.contract_check(uuid, text, text, text, text) to service_role;

-- enregistre la demande et l'applique tout de suite (Premium s'arrête à la date de fin, plus de renouvellement) ;
-- achat à vie : seul l'achat concerné est retiré (un autre achat à vie éventuel reste)
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
    update public.entitlements set life_family_at = case when p_product = 'fiitday_vie_famille' then null else life_family_at end,
      life_solo_at = case when p_product = 'fiitday_vie_solo' then null else life_solo_at end, updated_at = now() where user_id = p_user;
    update public.entitlements set lifetime_kind = case when life_family_at is not null then 'family' when life_solo_at is not null then 'solo' end where user_id = p_user;
  else
    -- sans toucher à event_at : les messages suivants de RevenueCat (résiliation, expiration) gardent cette date de fin
    update public.rc_subs set renews = false, until = least(until, r.end_at), updated_at = now() where user_id = p_user and store = p_store and product = p_product;
    select s.kind, s.until, s.store, s.renews into b from public.rc_subs s where s.user_id = p_user
      order by (s.until is not null and s.until > now()) desc, (s.kind = 'family') desc, s.renews desc nulls last, s.until desc nulls last limit 1;
    update public.entitlements set sub_kind = b.kind, sub_until = b.until, sub_store = b.store, sub_renews = b.renews, updated_at = now() where user_id = p_user;
  end if;
  return jsonb_build_object('ok', true, 'id', r.id, 'label', r.label, 'end_at', r.end_at, 'refund', r.refund, 'refund_all', r.refund_all,
    'price', (c ->> 'price')::numeric, 'kept', (c ->> 'kept')::numeric, 'bought', c ->> 'at', 'at', r.created_at,
    -- rétractations de ce compte (ou de cette adresse e-mail) : pour l'alerte « rétractations répétées »
    'retractations', case when p_kind = 'retractation' then (select count(*) from public.contract_requests q where q.kind = 'retractation'
      and (q.user_id = p_user or lower(q.email) = lower(trim(p_email)))) else 0 end);
end $function$;
revoke all on function public.contract_save(uuid, text, text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.contract_save(uuid, text, text, text, text, text, text, text) to service_role;

-- résultat des actions automatiques (RevenueCat, remboursement Stripe), connu après l'enregistrement de la demande
create or replace function public.contract_auto_set(p_id uuid, p_auto text)
 returns void language sql security definer set search_path to ''
as $function$ update public.contract_requests set auto = left(coalesce(p_auto, ''), 300) where id = p_id $function$;
revoke all on function public.contract_auto_set(uuid, text) from public, anon, authenticated;
grant execute on function public.contract_auto_set(uuid, text) to service_role;

/* ---------- 3. factures et avoirs ---------- */
-- identité du vendeur (nom « (EI) », adresse, SIRET, immatriculation), saisie dans Administration le jour du lancement :
-- gardée dans la base, jamais dans le dépôt public
alter table public.app_config add column if not exists seller jsonb not null default '{}'::jsonb;

create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  number text not null unique check (char_length(number) <= 40),
  kind text not null check (kind in ('facture', 'avoir')),
  test boolean not null default false,
  user_id uuid references auth.users(id) on delete set null,
  email text not null default '' check (char_length(email) <= 200),
  client text not null default '' check (char_length(client) <= 200),
  product text not null check (char_length(product) <= 100),
  label text not null check (char_length(label) <= 120),
  amount numeric(10, 2) not null check (amount >= 0 and amount < 100000),
  currency text not null default 'EUR' check (char_length(currency) = 3),
  store text not null default '' check (char_length(store) <= 30),
  paid_at timestamptz not null,
  period_start timestamptz,
  period_end timestamptz,
  ref_number text check (char_length(ref_number) <= 40),
  event_id text unique check (char_length(event_id) <= 100),
  contract_id uuid,
  mail text not null default '' check (char_length(mail) <= 300),
  tries integer not null default 0,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists invoices_user_product on public.invoices (user_id, product, paid_at desc);
alter table public.invoices enable row level security;
revoke all on public.invoices from anon, authenticated;

create table if not exists public.invoice_counters (series text primary key check (char_length(series) <= 30), last integer not null default 0);
alter table public.invoice_counters enable row level security;
revoke all on public.invoice_counters from anon, authenticated;

-- crée une facture (paiement) ou un avoir (remboursement) avec le numéro suivant de sa série, sans trou :
-- F2027-00001, A2027-00001 ; achats de test : TEST-F2027-00001 (série à part, hors registre)
create or replace function public.invoice_create(p jsonb)
 returns jsonb language plpgsql security definer set search_path to ''
as $function$
declare v_kind text := coalesce(p ->> 'kind', 'facture'); v_test boolean; v_user uuid; v_product text := left(coalesce(p ->> 'product', ''), 100);
  v_at timestamptz := coalesce((p ->> 'paid_at')::timestamptz, now()); v_amount numeric := round(coalesce((p ->> 'amount')::numeric, 0), 2);
  v_ref text := nullif(p ->> 'ref_number', ''); v_series text; v_n integer; v_num text; inv public.invoices; src public.invoices; pr record; u record;
begin
  if v_kind not in ('facture', 'avoir') or v_amount <= 0 or v_product = '' then return jsonb_build_object('ok', false, 'reason', 'facture invalide'); end if;
  if nullif(p ->> 'event_id', '') is not null then
    select * into inv from public.invoices where event_id = p ->> 'event_id';
    if found then return jsonb_build_object('ok', true, 'existing', true, 'invoice', to_jsonb(inv)); end if;
  end if;
  begin v_user := (p ->> 'user_id')::uuid; exception when others then v_user := null; end;
  v_test := coalesce((p ->> 'test')::boolean, true);
  if v_kind = 'avoir' then
    -- avoir : rattaché à la dernière facture de ce compte pour ce produit (même environnement)
    select * into src from public.invoices i where i.kind = 'facture' and i.user_id = v_user and i.product = v_product and (v_ref is null or i.number = v_ref)
      order by i.paid_at desc limit 1;
    if found then v_ref := src.number; v_test := src.test; end if;
  end if;
  select * into pr from public.fiitday_price(v_product, v_at);
  select au.email, coalesce(nullif(btrim(au.raw_user_meta_data ->> 'full_name'), ''), nullif(btrim(au.raw_user_meta_data ->> 'first_name'), '')) as name
    into u from auth.users au where au.id = v_user;
  v_series := (case when v_test then 'TEST-' else '' end) || (case when v_kind = 'facture' then 'F' else 'A' end) || to_char(v_at at time zone 'Europe/Paris', 'YYYY');
  insert into public.invoice_counters (series) values (v_series) on conflict (series) do nothing;
  update public.invoice_counters set last = last + 1 where series = v_series returning last into v_n; -- verrou de ligne : pas de doublon ni de trou
  v_num := v_series || '-' || lpad(v_n::text, 5, '0');
  insert into public.invoices (number, kind, test, user_id, email, client, product, label, amount, currency, store, paid_at, period_start, period_end, ref_number, event_id, contract_id)
  values (v_num, v_kind, v_test, v_user, left(coalesce(nullif(p ->> 'email', ''), u.email, ''), 200),
    left(coalesce(nullif(btrim(p ->> 'client'), ''), u.name, ''), 200), v_product, left(coalesce(pr.label, v_product), 120), v_amount,
    upper(left(coalesce(nullif(p ->> 'currency', ''), 'EUR'), 3)), left(coalesce(p ->> 'store', ''), 30), v_at,
    (p ->> 'period_start')::timestamptz, (p ->> 'period_end')::timestamptz, v_ref, nullif(left(p ->> 'event_id', 100), ''), nullif(p ->> 'contract_id', '')::uuid)
  returning * into inv;
  return jsonb_build_object('ok', true, 'existing', false, 'invoice', to_jsonb(inv));
end $function$;
revoke all on function public.invoice_create(jsonb) from public, anon, authenticated;
grant execute on function public.invoice_create(jsonb) to service_role;

create or replace function public.invoice_mark(p_id uuid, p_mail text)
 returns void language sql security definer set search_path to ''
as $function$
  update public.invoices set mail = left(coalesce(p_mail, ''), 300), tries = tries + 1,
    sent_at = case when coalesce(p_mail, '') like 'envoyé%' then now() else sent_at end where id = p_id
$function$;
revoke all on function public.invoice_mark(uuid, text) from public, anon, authenticated;
grant execute on function public.invoice_mark(uuid, text) to service_role;

-- factures pas encore envoyées (nouvel essai chaque jour pendant 30 jours) et identité du vendeur
create or replace function public.invoices_due()
 returns jsonb language sql security definer set search_path to ''
as $function$
  select coalesce(jsonb_agg(to_jsonb(i) order by i.created_at), '[]'::jsonb) from (
    select * from public.invoices where kind = 'facture' and sent_at is null and tries < 30 and created_at > now() - interval '30 days' and email <> '' limit 100) i
$function$;
revoke all on function public.invoices_due() from public, anon, authenticated;
grant execute on function public.invoices_due() to service_role;

create or replace function public.seller_info()
 returns jsonb language sql stable security definer set search_path to ''
as $function$ select coalesce((select c.seller from public.app_config c where c.id), '{}'::jsonb) $function$;
revoke all on function public.seller_info() from public, anon, authenticated;
grant execute on function public.seller_info() to service_role;

create or replace function public.admin_seller_save(p jsonb)
 returns jsonb language plpgsql security definer set search_path to 'public', 'pg_temp'
as $function$
begin
  if not public.admin_ok() then return public.admin_denied(); end if;
  update public.app_config set seller = jsonb_build_object(
      'name', left(btrim(coalesce(p ->> 'name', '')), 120), 'addr', left(btrim(coalesce(p ->> 'addr', '')), 300),
      'siret', left(regexp_replace(coalesce(p ->> 'siret', ''), '\s', '', 'g'), 14), 'immat', left(btrim(coalesce(p ->> 'immat', '')), 120),
      'vat', left(btrim(coalesce(p ->> 'vat', '')), 120)), updated_at = now()
  where id;
  return jsonb_build_object('ok', true);
end $function$;
create or replace function public.admin_seller()
 returns jsonb language plpgsql security definer set search_path to 'public', 'pg_temp'
as $function$
begin
  if not public.admin_ok() then return public.admin_denied(); end if;
  return jsonb_build_object('seller', public.seller_info(),
    'invoices', (select count(*) from public.invoices where not test), 'unsent', (select count(*) from public.invoices where not test and kind = 'facture' and sent_at is null));
end $function$;
revoke all on function public.admin_seller_save(jsonb), public.admin_seller() from public, anon;
grant execute on function public.admin_seller_save(jsonb), public.admin_seller() to authenticated;

/* ---------- 4. registre des recettes : une ligne par paiement ---------- */
-- les anciens brouillons (un par mois, paiements de test uniquement) sont remplacés à la prochaine lecture de Stripe
delete from public.ledger_drafts where entry_id is null;
alter table public.ledger_drafts drop constraint if exists ledger_drafts_source_livemode_period_key;
alter table public.ledger_drafts drop constraint if exists ledger_drafts_period_check;
alter table public.ledger_drafts add column if not exists stripe_id text check (char_length(stripe_id) <= 80);
alter table public.ledger_drafts add column if not exists kind text not null default 'paiement' check (kind in ('paiement', 'remboursement'));
alter table public.ledger_drafts add column if not exists paid_at timestamptz;
alter table public.ledger_drafts add column if not exists user_id uuid;
alter table public.ledger_drafts add column if not exists product text not null default '' check (char_length(product) <= 100);
alter table public.ledger_drafts add column if not exists invoice text not null default '' check (char_length(invoice) <= 40);
alter table public.ledger_drafts add column if not exists charge_id text not null default '' check (char_length(charge_id) <= 80);
do $$ begin
  alter table public.ledger_drafts add constraint ledger_drafts_stripe_key unique (source, livemode, stripe_id);
exception when duplicate_table or duplicate_object then null; end $$;

-- un remboursement est inscrit en négatif (montant encaissé puis rendu)
alter table public.revenue_ledger drop constraint if exists revenue_ledger_gross_check;
alter table public.revenue_ledger drop constraint if exists revenue_ledger_check;
alter table public.revenue_ledger add constraint revenue_ledger_gross_check check (gross > -10000000 and gross < 10000000);
alter table public.revenue_ledger add constraint revenue_ledger_check check (fees >= 0 and fees <= abs(gross));

-- p_months : la liste des paiements et remboursements lus dans Stripe (le nom vient de l'ancienne version, une ligne par mois)
create or replace function public.ledger_sync_save(p_source text, p_livemode boolean, p_ok boolean, p_message text, p_months jsonb)
 returns jsonb language plpgsql security definer set search_path to ''
as $function$
declare m jsonb; k integer := 0; v_user uuid; v_at timestamptz; v_kind text; v_inv text; v_product text; v_id text;
begin
  insert into public.ledger_sync (source, at, livemode, ok, message) values (p_source, now(), p_livemode, p_ok, left(coalesce(p_message, ''), 300))
  on conflict (source) do update set at = excluded.at, livemode = excluded.livemode, ok = excluded.ok, message = excluded.message;
  if not p_ok or p_months is null then return jsonb_build_object('ok', p_ok, 'rows', 0); end if;
  for m in select * from jsonb_array_elements(p_months) loop
    v_id := left(m ->> 'stripe_id', 80);
    if v_id is null then continue; end if; -- ancien format (un mois) : ignoré
    v_kind := case when m ->> 'kind' = 'remboursement' then 'remboursement' else 'paiement' end;
    v_at := to_timestamp((m ->> 'created')::bigint);
    v_product := left(coalesce(m ->> 'product', ''), 100);
    begin v_user := (m ->> 'user_id')::uuid; exception when others then v_user := null; end;
    -- pièce justificative : la facture (paiement) ou l'avoir (remboursement) du même compte, même produit, à 2 jours près
    select i.number into v_inv from public.invoices i
      where i.kind = case when v_kind = 'paiement' then 'facture' else 'avoir' end and i.test = not p_livemode and i.user_id = v_user
        and (v_product = '' or i.product = v_product) and i.paid_at between v_at - interval '2 days' and v_at + interval '2 days'
        and not exists (select 1 from public.ledger_drafts d2 where d2.invoice = i.number and d2.stripe_id is distinct from v_id)
      order by abs(extract(epoch from i.paid_at - v_at)) limit 1;
    if v_inv is null and v_kind = 'remboursement' then
      select 'sur ' || d3.invoice into v_inv from public.ledger_drafts d3 where d3.charge_id = m ->> 'charge_id' and d3.kind = 'paiement' and d3.invoice <> '' limit 1;
    end if;
    insert into public.ledger_drafts as d (source, livemode, stripe_id, charge_id, kind, paid_at, period, paid_on, closed, n, gross, fees, refunds, other_currency, ref, note, user_id, product, invoice)
    values (p_source, p_livemode, v_id, left(coalesce(m ->> 'charge_id', ''), 80), v_kind, v_at, (v_at at time zone 'Europe/Paris')::date, (v_at at time zone 'Europe/Paris')::date, true, 1,
      round(abs(coalesce((m ->> 'amount')::numeric, 0)), 2), round(greatest(coalesce((m ->> 'fee')::numeric, 0), 0), 2), 0,
      case when coalesce(m ->> 'currency', 'eur') <> 'eur' then 1 else 0 end, left(v_id, 80), left(coalesce(m ->> 'note', ''), 500), v_user, v_product, left(coalesce(v_inv, ''), 40))
    on conflict (source, livemode, stripe_id) do update set paid_at = excluded.paid_at, period = excluded.period, paid_on = excluded.paid_on, gross = excluded.gross,
      fees = excluded.fees, other_currency = excluded.other_currency, note = excluded.note, user_id = excluded.user_id, product = excluded.product,
      invoice = case when excluded.invoice <> '' then excluded.invoice else d.invoice end, charge_id = excluded.charge_id, updated_at = now()
    where d.entry_id is null and not d.dismissed; -- une ligne déjà validée ou ignorée ne bouge plus
    k := k + 1;
  end loop;
  return jsonb_build_object('ok', true, 'rows', k);
end $function$;
revoke all on function public.ledger_sync_save(text, boolean, boolean, text, jsonb) from public, anon, authenticated;
grant execute on function public.ledger_sync_save(text, boolean, boolean, text, jsonb) to service_role;

create or replace function public.admin_ledger_auto()
 returns jsonb language plpgsql security definer set search_path to 'public', 'pg_temp'
as $function$
declare s public.ledger_sync;
begin
  if not public.admin_ok() then return public.admin_denied(); end if;
  select * into s from public.ledger_sync where source = 'stripe';
  return jsonb_build_object(
    'sync', case when s.source is null then null else jsonb_build_object('at', s.at, 'livemode', s.livemode, 'ok', s.ok, 'message', s.message) end,
    'drafts', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'livemode', d.livemode, 'kind', d.kind, 'paid_at', d.paid_at, 'gross', d.gross, 'fees', d.fees,
        'other_currency', d.other_currency, 'ref', d.ref, 'invoice', d.invoice, 'note', d.note, 'label', coalesce((select p.label from public.fiitday_price(d.product, d.paid_at) p), ''))
        order by d.paid_at desc)
      from (select * from public.ledger_drafts x where x.entry_id is null and not x.dismissed and x.stripe_id is not null and x.livemode is not distinct from s.livemode
            order by x.paid_at desc limit 300) d), '[]'::jsonb),
    'at', now());
end $function$;

-- valide une ligne (ou toutes avec p_id null) : date du paiement (heure de Paris), facture comme pièce justificative
create or replace function public.admin_ledger_draft_validate(p_id uuid)
 returns jsonb language plpgsql security definer set search_path to 'public', 'pg_temp'
as $function$
declare d public.ledger_drafts; r public.revenue_ledger; inv public.invoices; n integer := 0; v_payer text;
begin
  if not public.admin_ok() then return public.admin_denied(); end if;
  for d in select * from public.ledger_drafts x where (p_id is null or x.id = p_id) and x.entry_id is null and not x.dismissed and x.stripe_id is not null
      order by x.paid_at, x.stripe_id for update loop
    if not d.livemode then
      if p_id is not null then return jsonb_build_object('ok', false, 'reason', 'Paiements de test : ils ne vont pas dans le registre'); end if;
      continue;
    end if;
    select * into inv from public.invoices i where i.number = regexp_replace(d.invoice, '^sur ', '');
    v_payer := coalesce(nullif(btrim(inv.client), ''), nullif(inv.email, ''), 'Client (paiement par carte)');
    insert into public.revenue_ledger (paid_on, payer, nature, method, ref, gross, fees, note)
    values ((d.paid_at at time zone 'Europe/Paris')::date, left(v_payer, 120),
      left(case when d.kind = 'remboursement' then 'Remboursement : ' else '' end || coalesce(nullif(inv.label, ''), 'Fiitday Premium'), 200),
      'Carte bancaire (Stripe)', left(coalesce(nullif(d.invoice, ''), d.stripe_id), 80),
      case when d.kind = 'remboursement' then -d.gross else d.gross end, case when d.kind = 'remboursement' then 0 else least(d.fees, d.gross) end,
      left(concat_ws(' ', 'Stripe ' || d.stripe_id || '.', case when d.kind = 'remboursement' and d.fees > 0 then 'Frais Stripe du remboursement : ' || replace(to_char(d.fees, 'FM999990.00'), '.', ',') || ' €.' end,
        case when d.other_currency > 0 then 'Paiement dans une autre devise que l''euro : montant à vérifier.' end), 500))
    returning * into r;
    insert into public.revenue_ledger_log (entry_id, action, after) values (r.id, 'create', to_jsonb(r));
    update public.ledger_drafts set entry_id = r.id, updated_at = now() where id = d.id;
    n := n + 1;
  end loop;
  if p_id is not null and n = 0 then return jsonb_build_object('ok', false, 'reason', 'Ligne introuvable ou déjà traitée'); end if;
  return jsonb_build_object('ok', true, 'added', n);
end $function$;
revoke all on function public.admin_ledger_auto(), public.admin_ledger_draft_validate(uuid) from public, anon;
grant execute on function public.admin_ledger_auto(), public.admin_ledger_draft_validate(uuid) to authenticated;

/* ---------- 5. comptes inactifs : supprimés après 2 ans sans utilisation, après un e-mail de prévenance ---------- */
create table if not exists public.account_activity (
  user_id uuid primary key references auth.users(id) on delete cascade,
  last_seen timestamptz not null default now(),
  warned_at timestamptz,
  warn_mail text not null default '' check (char_length(warn_mail) <= 300)
);
alter table public.account_activity enable row level security;
revoke all on public.account_activity from anon, authenticated;
insert into public.account_activity (user_id, last_seen)
select u.id, greatest(u.created_at, coalesce(u.last_sign_in_at, u.created_at)) from auth.users u
on conflict (user_id) do nothing;

-- comptes supprimés pour inactivité : l'appli d'un appareil qui revient garde ses données (au lieu de les effacer)
create table if not exists public.inactive_deleted (user_id uuid primary key, at timestamptz not null default now());
alter table public.inactive_deleted enable row level security;
revoke all on public.inactive_deleted from anon, authenticated;

-- statut du compte, appelé par l'appli à chaque ouverture : note aussi la dernière utilisation (au plus une fois par 12 h)
create or replace function public.my_plan()
 returns jsonb language plpgsql security definer set search_path to 'public', 'pg_temp'
as $function$
declare me uuid := auth.uid();
begin
  if me is null or not exists (select 1 from auth.users u where u.id = me) then return jsonb_build_object('state', 'none'); end if;
  insert into public.account_activity as a (user_id, last_seen) values (me, now())
  on conflict (user_id) do update set last_seen = now(), warned_at = null, warn_mail = ''
  where a.last_seen < now() - interval '12 hours' or a.warned_at is not null;
  return public.plan_info(me);
end $function$;
revoke all on function public.my_plan() from public, anon;
grant execute on function public.my_plan() to authenticated;

-- Premium payé ou offert en cours (abonnement, achat à vie, Premium offert) : jamais supprimé pour inactivité
create or replace function public.inactive_protected(p_user uuid)
 returns boolean language sql stable security definer set search_path to ''
as $function$
  select p_user = '8d8a867f-e766-41ca-b197-7694f5f5e1c4'::uuid or exists (select 1 from public.own_rights(p_user, now()))
    or exists (select 1 from public.rc_subs s where s.user_id = p_user and s.renews)
$function$;
revoke all on function public.inactive_protected(uuid) from public, anon, authenticated;
grant execute on function public.inactive_protected(uuid) to service_role;

-- comptes à prévenir : 23 mois sans utilisation ; suppression au plus tôt 30 jours après l'e-mail
create or replace function public.inactive_due()
 returns jsonb language sql security definer set search_path to ''
as $function$
  select coalesce(jsonb_agg(jsonb_build_object('user_id', x.user_id, 'email', x.email, 'first_name', x.first_name,
      'last_seen', x.last_seen, 'delete_on', greatest(x.last_seen + interval '2 years', now() + interval '30 days'))), '[]'::jsonb)
  from (select a.user_id, u.email, u.raw_user_meta_data ->> 'first_name' as first_name, a.last_seen
    from public.account_activity a join auth.users u on u.id = a.user_id
    where a.warned_at is null and a.last_seen < now() - interval '23 months' and u.email is not null and not public.inactive_protected(a.user_id)
    limit 200) x
$function$;
revoke all on function public.inactive_due() from public, anon, authenticated;
grant execute on function public.inactive_due() to service_role;

create or replace function public.inactive_mark(p_user uuid, p_mail text)
 returns void language sql security definer set search_path to ''
as $function$
  update public.account_activity set warn_mail = left(coalesce(p_mail, ''), 300),
    warned_at = case when coalesce(p_mail, '') like 'envoyé%' then now() else warned_at end where user_id = p_user
$function$;
revoke all on function public.inactive_mark(uuid, text) from public, anon, authenticated;
grant execute on function public.inactive_mark(uuid, text) to service_role;

-- suppression d'un compte inactif : comme « Supprimer mon compte » (empreinte de l'essai gardée 3 ans, client RevenueCat effacé)
create or replace function public.inactive_delete(p_user uuid)
 returns boolean language plpgsql security definer set search_path to ''
as $function$
declare em text;
begin
  if public.inactive_protected(p_user) then return false; end if;
  select u.email into em from auth.users u where u.id = p_user;
  if not found then return false; end if;
  if em is not null then
    insert into public.trial_used (email_hash) values (public.email_hash(em)), (public.email_hash(public.email_norm(em))) on conflict (email_hash) do nothing;
  end if;
  delete from public.family_log where user_id = p_user;
  delete from public.family_tries where user_id = p_user;
  delete from public.admin_access_log where user_id = p_user;
  update public.family_invites set used_by = null where used_by = p_user;
  insert into public.rc_pending_delete (user_id) values (p_user) on conflict (user_id) do nothing;
  insert into public.inactive_deleted (user_id) values (p_user) on conflict (user_id) do nothing;
  delete from auth.users where id = p_user;
  return true;
end $function$;
revoke all on function public.inactive_delete(uuid) from public, anon, authenticated;

-- l'appli demande si son compte existe encore : true, false, ou "inactive" (supprimé pour inactivité : données gardées)
drop function if exists public.account_exists(uuid);
create function public.account_exists(p_uid uuid)
 returns jsonb language sql stable security definer set search_path to ''
as $function$
  select case when exists (select 1 from auth.users u where u.id = p_uid) then 'true'::jsonb
    when exists (select 1 from public.inactive_deleted d where d.user_id = p_uid) then '"inactive"'::jsonb else 'false'::jsonb end
$function$;
revoke all on function public.account_exists(uuid) from public;
grant execute on function public.account_exists(uuid) to anon, authenticated;

create or replace function public.daily_purge()
 returns jsonb language plpgsql security definer set search_path to ''
as $function$
declare a int; b int; c int; d int; e int; f int; g int; h int; i int := 0; j int; k int; uid uuid;
begin
  delete from public.contract_requests where coalesce(end_at, created_at) < now() - interval '5 years'; get diagnostics a = row_count;
  delete from public.purchase_consents where user_id is null and at < now() - interval '5 years'; get diagnostics b = row_count;
  delete from auth.users where email_confirmed_at is null and created_at < now() - interval '30 days'; get diagnostics c = row_count;
  delete from public.trial_used where at < now() - interval '3 years'; get diagnostics d = row_count;
  delete from public.family_log where at < now() - interval '12 months'; get diagnostics e = row_count;
  delete from public.rc_seen where at < now() - interval '90 days'; get diagnostics f = row_count;
  delete from public.order_confirmations where created_at < now() - interval '5 years'; get diagnostics g = row_count;
  delete from public.shares where created_at < now() - interval '7 days'; get diagnostics h = row_count;
  -- comptes sans utilisation depuis 2 ans, prévenus par e-mail il y a 30 jours au moins
  for uid in select a2.user_id from public.account_activity a2
      where a2.last_seen < now() - interval '2 years' and a2.warned_at is not null and a2.warned_at < now() - interval '30 days' limit 100 loop
    if public.inactive_delete(uid) then i := i + 1; end if;
  end loop;
  delete from public.inactive_deleted where at < now() - interval '3 years'; get diagnostics j = row_count;
  -- factures et avoirs : 10 ans (obligation comptable)
  delete from public.invoices where created_at < now() - interval '10 years'; get diagnostics k = row_count;
  return jsonb_build_object('demandes', a, 'accords', b, 'comptes_non_verifies', c, 'empreintes', d, 'journal_familles', e, 'messages_rc', f,
    'confirmations', g, 'partages', h, 'comptes_inactifs', i, 'traces_inactifs', j, 'factures', k, 'at', now());
end $function$;
revoke all on function public.daily_purge() from public, anon, authenticated;

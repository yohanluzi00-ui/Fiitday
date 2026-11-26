-- ⚠ HISTORIQUE — NE PAS RELANCER. Ce fichier a déjà été appliqué ; la base a évolué depuis (abonnement, Premium,
-- verrous de la version gratuite). Le relancer remplacerait des protections actuelles par d'anciennes versions.
-- Référence : l'historique des migrations de Supabase (Database › Migrations) et supabase/migrations/ ; voir supabase/LISEZMOI.md.
-- Résiliation et rétractation en ligne, e-mails obligatoires (25/11/2026)
-- Code de la consommation : L215-1-1 et D215-1 à D215-3 (résilier en ligne), L224-25-9 (fin au plus tard 10 jours
-- après la demande, sauf si le client choisit plus tard), L221-21 et D221-5 (« Renoncer au contrat ici » pendant 14 jours),
-- L221-13 (confirmation de la commande sur support durable), L215-1 (rappel avant la reconduction d'un abonnement annuel).
-- La fonction Edge « contrat » fait le travail (RevenueCat, e-mails Brevo) ; ces fonctions SQL vérifient et enregistrent.

-- date du premier achat de chaque abonnement (le délai de rétractation part de là)
alter table public.rc_subs add column if not exists first_at timestamptz;
update public.rc_subs set first_at = event_at where first_at is null;
-- boutique de l'achat à vie (pour savoir où le rembourser)
alter table public.entitlements add column if not exists life_store text;

-- demande expresse cochée avant le paiement (preuve, et rappel dans l'e-mail de confirmation)
create table if not exists public.purchase_consents (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  product text not null check (char_length(product) between 1 and 100),
  text text not null check (char_length(text) between 1 and 400),
  at timestamptz not null default now()
);
create index if not exists purchase_consents_user on public.purchase_consents (user_id, at desc);
alter table public.purchase_consents enable row level security;
revoke all on public.purchase_consents from anon, authenticated;

create or replace function public.record_purchase_consent(p_product text, p_text text)
 returns jsonb language plpgsql security definer set search_path to ''
as $function$
begin
  if auth.uid() is null then return jsonb_build_object('ok', false); end if;
  if coalesce(p_product, '') !~ '^fiitday_[a-z_]{3,40}$' or char_length(coalesce(p_text, '')) not between 10 and 400 then return jsonb_build_object('ok', false); end if;
  -- au plus 30 par jour et par compte
  if (select count(*) from public.purchase_consents c where c.user_id = auth.uid() and c.at > now() - interval '1 day') >= 30 then return jsonb_build_object('ok', false); end if;
  insert into public.purchase_consents (user_id, product, text) values (auth.uid(), p_product, p_text);
  return jsonb_build_object('ok', true);
end $function$;
revoke all on function public.record_purchase_consent(text, text) from public, anon;
grant execute on function public.record_purchase_consent(text, text) to authenticated;

-- résiliations et rétractations notifiées en ligne (gardées pour la preuve et les remboursements)
create table if not exists public.contract_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  kind text not null check (kind in ('resiliation', 'retractation')),
  store text not null check (char_length(store) between 1 and 30),
  product text not null check (char_length(product) between 1 and 100),
  label text not null default '' check (char_length(label) <= 120),
  name text not null check (char_length(name) between 2 and 120),
  email text not null check (char_length(email) between 5 and 200),
  wish text check (wish in ('fin', 'maintenant')),
  end_at timestamptz not null,
  refund numeric(10, 2) not null default 0 check (refund >= 0),
  refund_all boolean not null default false,
  auto text not null default '' check (char_length(auto) <= 300),
  mail text not null default '' check (char_length(mail) <= 300),
  created_at timestamptz not null default now(),
  done_at timestamptz
);
create index if not exists contract_requests_user on public.contract_requests (user_id, created_at desc);
alter table public.contract_requests enable row level security;
revoke all on public.contract_requests from anon, authenticated;

-- prix catalogue (euros) et durée d'une période, pour les remboursements au prorata
create or replace function public.fiitday_price(p_product text)
 returns table (amount numeric, months integer, label text) language sql immutable set search_path to ''
as $function$
  select v.amount, v.months, v.label from (values
    ('fiitday_solo_annuel', 19.90, 12, 'Premium Solo annuel'), ('fiitday_solo_mensuel', 1.99, 1, 'Premium Solo mensuel'),
    ('fiitday_famille_annuel', 69.90, 12, 'Premium Famille annuel'), ('fiitday_famille_mensuel', 6.99, 1, 'Premium Famille mensuel'),
    ('fiitday_vie_solo', 49.90, 0, 'Premium Solo à vie'), ('fiitday_vie_famille', 149.90, 0, 'Premium Famille à vie')) as v(product, amount, months, label)
  where v.product = p_product
$function$;

-- fin du délai de rétractation : 14 jours après le jour de l'achat (heure de Paris), repoussé au lundi s'il finit un samedi ou un dimanche
create or replace function public.retract_until(p_at timestamptz)
 returns timestamptz language sql stable set search_path to ''
as $function$
  select ((d + case extract(isodow from d - 1) when 6 then 2 when 7 then 1 else 0 end)::timestamp) at time zone 'Europe/Paris'
  from (select ((p_at at time zone 'Europe/Paris')::date + 15) as d) x
$function$;

-- ce que le compte connecté a acheté, et ce qu'il peut résilier ou rétracter
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
    'life', case when e.lifetime_kind is null then null else jsonb_build_object('kind', e.lifetime_kind, 'at', e.life_event_at, 'store', coalesce(e.life_store, 'INCONNU'),
      'retract_until', public.retract_until(e.life_event_at), 'product', case when e.lifetime_kind = 'family' then 'fiitday_vie_famille' else 'fiitday_vie_solo' end) end,
    'requests', coalesce((select jsonb_agg(jsonb_build_object('kind', r.kind, 'product', r.product, 'label', r.label, 'at', r.created_at, 'end_at', r.end_at,
        'refund', r.refund, 'refund_all', r.refund_all) order by r.created_at desc) from public.contract_requests r where r.user_id = uid and r.created_at > now() - interval '400 days'), '[]'::jsonb));
end $function$;
revoke all on function public.my_contracts() from public, anon;
grant execute on function public.my_contracts() to authenticated;

-- vérifie une demande et calcule la date de fin et le remboursement (appelée par la fonction Edge, avec la clé du serveur)
create or replace function public.contract_check(p_user uuid, p_kind text, p_store text, p_product text, p_wish text)
 returns jsonb language plpgsql security definer set search_path to ''
as $function$
declare s public.rc_subs; e public.entitlements; pr record; start_at timestamptz; v_end timestamptz; v_refund numeric := 0;
begin
  select * into pr from public.fiitday_price(p_product);
  if pr is null then return jsonb_build_object('ok', false, 'reason', 'Produit inconnu'); end if;
  if p_product ~ '_vie_' then
    -- achat à vie : seulement la rétractation, pendant 14 jours
    select * into e from public.entitlements where user_id = p_user;
    if p_kind <> 'retractation' then return jsonb_build_object('ok', false, 'reason', 'Un achat à vie ne se résilie pas'); end if;
    if e.lifetime_kind is null or (e.lifetime_kind = 'family') <> (p_product = 'fiitday_vie_famille') then return jsonb_build_object('ok', false, 'reason', 'Achat introuvable'); end if;
    if now() > public.retract_until(e.life_event_at) then return jsonb_build_object('ok', false, 'reason', 'Le délai de 14 jours est dépassé'); end if;
    return jsonb_build_object('ok', true, 'label', pr.label, 'end_at', now(), 'refund', pr.amount, 'refund_all', true, 'lifetime', true, 'at', e.life_event_at);
  end if;
  select * into s from public.rc_subs where user_id = p_user and store = p_store and product = p_product;
  if s.user_id is null or s.until <= now() then return jsonb_build_object('ok', false, 'reason', 'Abonnement introuvable ou déjà terminé'); end if;
  if p_kind = 'retractation' then
    if now() > public.retract_until(coalesce(s.first_at, s.event_at)) then return jsonb_build_object('ok', false, 'reason', 'Le délai de 14 jours est dépassé'); end if;
    return jsonb_build_object('ok', true, 'label', pr.label, 'end_at', now(), 'refund', pr.amount, 'refund_all', true, 'until', s.until, 'renews', s.renews, 'at', s.first_at);
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
    return jsonb_build_object('ok', true, 'label', pr.label, 'end_at', v_end, 'refund', v_refund, 'refund_all', false, 'until', s.until, 'renews', s.renews);
  end if;
  return jsonb_build_object('ok', false, 'reason', 'Demande inconnue');
end $function$;
revoke all on function public.contract_check(uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.contract_check(uuid, text, text, text, text) to service_role;

-- enregistre la demande et l'applique tout de suite (Premium s'arrête à la date de fin, plus de renouvellement)
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
    update public.entitlements set lifetime_kind = null, updated_at = now() where user_id = p_user;
  else
    -- sans toucher à event_at : les messages suivants de RevenueCat (résiliation, expiration) gardent cette date de fin
    update public.rc_subs set renews = false, until = least(until, r.end_at), updated_at = now() where user_id = p_user and store = p_store and product = p_product;
    select s.kind, s.until, s.store, s.renews into b from public.rc_subs s where s.user_id = p_user
      order by (s.until is not null and s.until > now()) desc, (s.kind = 'family') desc, s.renews desc nulls last, s.until desc nulls last limit 1;
    update public.entitlements set sub_kind = b.kind, sub_until = b.until, sub_store = b.store, sub_renews = b.renews, updated_at = now() where user_id = p_user;
  end if;
  return jsonb_build_object('ok', true, 'id', r.id, 'label', r.label, 'end_at', r.end_at, 'refund', r.refund, 'refund_all', r.refund_all, 'at', r.created_at);
end $function$;
revoke all on function public.contract_save(uuid, text, text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.contract_save(uuid, text, text, text, text, text, text, text) to service_role;

create or replace function public.contract_mail_status(p_id uuid, p_mail text)
 returns void language sql security definer set search_path to ''
as $function$ update public.contract_requests set mail = left(coalesce(p_mail, ''), 300) where id = p_id $function$;
revoke all on function public.contract_mail_status(uuid, text) from public, anon, authenticated;
grant execute on function public.contract_mail_status(uuid, text) to service_role;

-- dernière demande expresse cochée pour un produit (e-mail de confirmation de la commande)
create or replace function public.purchase_consent_for(p_user uuid, p_product text)
 returns jsonb language sql security definer set search_path to ''
as $function$
  select jsonb_build_object('text', c.text, 'at', c.at) from public.purchase_consents c
  where c.user_id = p_user and c.product = p_product and c.at > now() - interval '2 days' order by c.at desc limit 1
$function$;
revoke all on function public.purchase_consent_for(uuid, text) from public, anon, authenticated;
grant execute on function public.purchase_consent_for(uuid, text) to service_role;

-- rappels avant la reconduction d'un abonnement annuel (entre 3 mois et 1 mois avant ; envoyés à 60 jours)
create table if not exists public.renewal_reminders (
  user_id uuid not null references auth.users(id) on delete cascade,
  store text not null, product text not null, until timestamptz not null,
  sent_at timestamptz not null default now(), status text not null default '' check (char_length(status) <= 300),
  primary key (user_id, store, product, until)
);
alter table public.renewal_reminders enable row level security;
revoke all on public.renewal_reminders from anon, authenticated;

create or replace function public.renewal_due()
 returns jsonb language sql security definer set search_path to ''
as $function$
  select coalesce(jsonb_agg(jsonb_build_object('user_id', s.user_id, 'store', s.store, 'product', s.product, 'until', s.until,
      'email', u.email, 'first_name', u.raw_user_meta_data ->> 'first_name', 'label', p.label, 'amount', p.amount)), '[]'::jsonb)
  from public.rc_subs s join auth.users u on u.id = s.user_id cross join lateral public.fiitday_price(s.product) p
  where s.renews and p.months = 12 and s.until between now() + interval '32 days' and now() + interval '60 days'
    and not exists (select 1 from public.renewal_reminders r where r.user_id = s.user_id and r.store = s.store and r.product = s.product and r.until = s.until)
  limit 200
$function$;
revoke all on function public.renewal_due() from public, anon, authenticated;
grant execute on function public.renewal_due() to service_role;

create or replace function public.renewal_mark(p_user uuid, p_store text, p_product text, p_until timestamptz, p_status text)
 returns void language sql security definer set search_path to ''
as $function$
  insert into public.renewal_reminders (user_id, store, product, until, status) values (p_user, p_store, p_product, p_until, left(coalesce(p_status, ''), 300))
  on conflict (user_id, store, product, until) do update set status = excluded.status, sent_at = now()
$function$;
revoke all on function public.renewal_mark(uuid, text, text, timestamptz, text) from public, anon, authenticated;
grant execute on function public.renewal_mark(uuid, text, text, timestamptz, text) to service_role;

-- administration : demandes à traiter (remboursements à faire à la main) et rappels envoyés
create or replace function public.admin_contracts()
 returns jsonb language plpgsql security definer set search_path to 'public', 'pg_temp'
as $function$
begin
  if not public.admin_ok() then return public.admin_denied(); end if;
  return jsonb_build_object(
    'requests', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'kind', r.kind, 'store', r.store, 'product', r.product, 'label', r.label, 'name', r.name,
        'email', r.email, 'wish', r.wish, 'end_at', r.end_at, 'refund', r.refund, 'refund_all', r.refund_all, 'auto', r.auto, 'mail', r.mail,
        'at', r.created_at, 'done_at', r.done_at) order by r.created_at desc) from (select * from public.contract_requests order by created_at desc limit 60) r), '[]'::jsonb),
    'reminders', (select count(*) from public.renewal_reminders where sent_at > now() - interval '30 days'),
    'at', now());
end $function$;

create or replace function public.admin_contract_done(p_id uuid)
 returns jsonb language plpgsql security definer set search_path to 'public', 'pg_temp'
as $function$
begin
  if not public.admin_ok() then return public.admin_denied(); end if;
  update public.contract_requests set done_at = now() where id = p_id and done_at is null;
  return jsonb_build_object('ok', found);
end $function$;
revoke all on function public.admin_contracts(), public.admin_contract_done(uuid) from public, anon;
grant execute on function public.admin_contracts(), public.admin_contract_done(uuid) to authenticated;

-- rc_apply : date du premier achat de chaque abonnement (le délai de rétractation part de là), et le compte, le produit
-- et la boutique renvoyés à la fonction Edge (e-mail de confirmation de la commande)
do $$
declare d text; n text;
begin
  d := pg_get_functiondef('public.rc_apply(jsonb)'::regprocedure);
  n := replace(replace(replace(d,
    $o$update public.entitlements set lifetime_kind = case when v_kind = 'family' or lifetime_kind = 'family' then 'family' else 'solo' end, life_event_at = ts, updated_at = now() where user_id = uid;$o$,
    $n$update public.entitlements set lifetime_kind = case when v_kind = 'family' or lifetime_kind = 'family' then 'family' else 'solo' end, life_event_at = ts, life_store = st, updated_at = now() where user_id = uid;$n$),
    $o$insert into public.rc_subs as s (user_id, store, product, kind, until, renews, event_at)
    values (uid, st, left(v_product, 100), v_kind, new_until, new_renews, ts)
    on conflict (user_id, store, product) do update set kind = excluded.kind, until = excluded.until, renews = excluded.renews, event_at = excluded.event_at, updated_at = now();$o$,
    $n$insert into public.rc_subs as s (user_id, store, product, kind, until, renews, event_at, first_at)
    values (uid, st, left(v_product, 100), v_kind, new_until, new_renews, ts, ts)
    on conflict (user_id, store, product) do update set kind = excluded.kind, until = excluded.until, renews = excluded.renews, event_at = excluded.event_at, updated_at = now(),
      first_at = case when typ = 'INITIAL_PURCHASE' then ts else coalesce(s.first_at, ts) end;$n$),
    $o$return jsonb_build_object('applied', true, 'type', typ, 'kind', v_kind, 'lifetime', life);$o$,
    $n$return jsonb_build_object('applied', true, 'type', typ, 'kind', v_kind, 'lifetime', life, 'user_id', uid, 'product', v_product, 'store', st, 'env', env,
      'until', case when life then null else (select s.until from public.rc_subs s where s.user_id = uid and s.store = st and s.product = left(v_product, 100)) end);$n$);
  if n = d or position('first_at' in n) = 0 or position('''user_id'', uid' in n) = 0 or position('life_store = st' in n) = 0 then raise exception 'rc_apply : passages à remplacer introuvables'; end if;
  execute n;
end $$;

-- tâche quotidienne : rappels avant la reconduction (9 h 17 à Paris l'hiver, 10 h 17 l'été). Le secret qui protège l'appel
-- est créé ici, dans le coffre de Supabase (Vault) : personne n'a besoin de le voir ni de le copier.
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
select vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'fiitday_cron_secret', 'Rappels quotidiens de la fonction Edge contrat')
where not exists (select 1 from vault.secrets where name = 'fiitday_cron_secret');

create or replace function public.cron_secret_ok(p text)
 returns boolean language sql security definer set search_path to ''
as $function$ select exists (select 1 from vault.decrypted_secrets where name = 'fiitday_cron_secret' and decrypted_secret = p) $function$;
revoke all on function public.cron_secret_ok(text) from public, anon, authenticated;
grant execute on function public.cron_secret_ok(text) to service_role;

create or replace function public.cron_status()
 returns text language sql security definer set search_path to ''
as $function$
  select coalesce((select 'planifiée tous les jours vers 9 h 17 (10 h 17 en été)' || coalesce(' · dernier passage le ' ||
      (select to_char(d.start_time at time zone 'Europe/Paris', 'DD/MM à HH24:MI') || ' : ' || d.status from cron.job_run_details d where d.jobid = j.jobid order by d.start_time desc limit 1), '')
    from cron.job j where j.jobname = 'fiitday-rappels-reconduction'), 'pas planifiée')
$function$;
revoke all on function public.cron_status() from public, anon, authenticated;
grant execute on function public.cron_status() to service_role;

select cron.unschedule('fiitday-rappels-reconduction') where exists (select 1 from cron.job where jobname = 'fiitday-rappels-reconduction');
select cron.schedule('fiitday-rappels-reconduction', '17 8 * * *', $c$
  select net.http_post(url := 'https://krszgabjpswqjtypalsn.supabase.co/functions/v1/contrat',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'fiitday_cron_secret')),
    body := '{"action":"rappels"}'::jsonb, timeout_milliseconds := 30000)
$c$);

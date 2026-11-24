-- Registre des recettes automatique (24/11/2026) : la fonction Edge « ledger-stripe » lit les encaissements par carte
-- dans Stripe (clé restreinte en lecture seule STRIPE_READ_KEY, enregistrée dans Supabase › Edge Functions › Secrets)
-- et prépare une ligne par mois. Rien n'entre dans le registre sans validation dans Administration › Registre des recettes.
-- Les paiements de test (mode test de Stripe) sont montrés comme exemple mais ne peuvent pas aller dans le registre.

create table if not exists public.ledger_drafts (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('stripe')),
  livemode boolean not null,
  period date not null check (extract(day from period) = 1),
  paid_on date not null,
  closed boolean not null default false,
  n integer not null default 0 check (n >= 0),
  gross numeric not null default 0 check (gross >= 0 and gross < 10000000),
  fees numeric not null default 0 check (fees >= 0 and fees < 10000000),
  refunds numeric not null default 0 check (refunds >= 0 and refunds < 10000000),
  other_currency integer not null default 0 check (other_currency >= 0),
  ref text not null default '' check (char_length(ref) <= 80),
  note text not null default '' check (char_length(note) <= 500),
  entry_id uuid references public.revenue_ledger(id) on delete set null,
  dismissed boolean not null default false,
  updated_at timestamptz not null default now(),
  unique (source, livemode, period)
);
alter table public.ledger_drafts enable row level security;
revoke all on public.ledger_drafts from anon, authenticated;

create table if not exists public.ledger_sync (
  source text primary key check (source in ('stripe')),
  at timestamptz not null,
  livemode boolean,
  ok boolean not null,
  message text not null default '' check (char_length(message) <= 300)
);
alter table public.ledger_sync enable row level security;
revoke all on public.ledger_sync from anon, authenticated;

-- appelée seulement par la fonction Edge (clé du serveur) : enregistre la lecture de Stripe et les lignes du mois
create or replace function public.ledger_sync_save(p_source text, p_livemode boolean, p_ok boolean, p_message text, p_months jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare m jsonb; k integer := 0;
begin
  insert into public.ledger_sync (source, at, livemode, ok, message) values (p_source, now(), p_livemode, p_ok, left(coalesce(p_message, ''), 300))
  on conflict (source) do update set at = excluded.at, livemode = excluded.livemode, ok = excluded.ok, message = excluded.message;
  if not p_ok or p_months is null then return jsonb_build_object('ok', p_ok, 'months', 0); end if;
  for m in select * from jsonb_array_elements(p_months) loop
    insert into public.ledger_drafts as d (source, livemode, period, paid_on, closed, n, gross, fees, refunds, other_currency, ref, note)
    values (p_source, p_livemode, (m ->> 'period')::date, (m ->> 'paid_on')::date, coalesce((m ->> 'closed')::boolean, false),
      coalesce((m ->> 'n')::integer, 0), round(coalesce((m ->> 'gross')::numeric, 0), 2), round(coalesce((m ->> 'fees')::numeric, 0), 2),
      round(coalesce((m ->> 'refunds')::numeric, 0), 2), coalesce((m ->> 'other_currency')::integer, 0), left(coalesce(m ->> 'ref', ''), 80), left(coalesce(m ->> 'note', ''), 500))
    on conflict (source, livemode, period) do update set paid_on = excluded.paid_on, closed = excluded.closed, n = excluded.n, gross = excluded.gross,
      fees = excluded.fees, refunds = excluded.refunds, other_currency = excluded.other_currency, ref = excluded.ref, note = excluded.note, updated_at = now()
    where d.entry_id is null and not d.dismissed; -- une ligne déjà validée ou ignorée ne bouge plus
    k := k + 1;
  end loop;
  return jsonb_build_object('ok', true, 'months', k);
end $function$;
revoke all on function public.ledger_sync_save(text, boolean, boolean, text, jsonb) from public, anon, authenticated;
grant execute on function public.ledger_sync_save(text, boolean, boolean, text, jsonb) to service_role;

-- administrateur : dernière lecture de Stripe et lignes à valider (du même mode que la dernière lecture)
create or replace function public.admin_ledger_auto()
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare s public.ledger_sync;
begin
  if not public.admin_ok() then return public.admin_denied(); end if;
  select * into s from public.ledger_sync where source = 'stripe';
  return jsonb_build_object(
    'sync', case when s.source is null then null else jsonb_build_object('at', s.at, 'livemode', s.livemode, 'ok', s.ok, 'message', s.message) end,
    'drafts', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'livemode', d.livemode, 'period', d.period, 'paid_on', d.paid_on, 'closed', d.closed,
        'n', d.n, 'gross', d.gross, 'fees', d.fees, 'refunds', d.refunds, 'other_currency', d.other_currency, 'ref', d.ref, 'note', d.note) order by d.period desc)
      from public.ledger_drafts d where d.entry_id is null and not d.dismissed and d.livemode is not distinct from s.livemode and (d.n > 0 or d.refunds > 0)), '[]'::jsonb),
    'at', now());
end $function$;

-- administrateur : ajouter au registre la ligne d'un mois terminé (paiements réels seulement)
create or replace function public.admin_ledger_draft_validate(p_id uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare d public.ledger_drafts; r public.revenue_ledger; v_gross numeric; v_fees numeric;
  mois constant text[] := array['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'];
begin
  if not public.admin_ok() then return public.admin_denied(); end if;
  select * into d from public.ledger_drafts where id = p_id for update;
  if not found or d.entry_id is not null or d.dismissed then return jsonb_build_object('ok', false, 'reason', 'Ligne introuvable ou déjà traitée'); end if;
  if not d.livemode then return jsonb_build_object('ok', false, 'reason', 'Paiements de test : ils ne vont pas dans le registre'); end if;
  if not d.closed then return jsonb_build_object('ok', false, 'reason', 'Le mois n''est pas terminé'); end if;
  v_gross := greatest(d.gross - d.refunds, 0); v_fees := least(d.fees, v_gross);
  insert into public.revenue_ledger (paid_on, payer, nature, method, ref, gross, fees, note)
  values (d.paid_on, 'Clients (paiements par carte, Stripe)',
    'Abonnements et achats Fiitday Premium, ' || mois[extract(month from d.period)::int] || ' ' || extract(year from d.period)::int || ' (' || d.n || ' paiement' || case when d.n > 1 then 's' else '' end || ')',
    'Carte bancaire', d.ref, v_gross, v_fees,
    left(trim(both ' ' from concat_ws(' ', case when d.refunds > 0 then 'Remboursements déduits : ' || replace(to_char(d.refunds, 'FM999999990.00'), '.', ',') || ' €.' end, nullif(d.note, ''))), 500))
  returning * into r;
  insert into public.revenue_ledger_log (entry_id, action, after) values (r.id, 'create', to_jsonb(r));
  update public.ledger_drafts set entry_id = r.id, updated_at = now() where id = d.id;
  return jsonb_build_object('ok', true, 'id', r.id);
end $function$;

-- administrateur : ignorer une ligne proposée (elle ne revient plus)
create or replace function public.admin_ledger_draft_dismiss(p_id uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
begin
  if not public.admin_ok() then return public.admin_denied(); end if;
  update public.ledger_drafts set dismissed = true, updated_at = now() where id = p_id and entry_id is null;
  return jsonb_build_object('ok', found);
end $function$;

revoke all on function public.admin_ledger_auto(), public.admin_ledger_draft_validate(uuid), public.admin_ledger_draft_dismiss(uuid) from public, anon;
grant execute on function public.admin_ledger_auto(), public.admin_ledger_draft_validate(uuid), public.admin_ledger_draft_dismiss(uuid) to authenticated;

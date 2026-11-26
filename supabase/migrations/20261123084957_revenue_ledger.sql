-- Registre des recettes (micro-entreprise) : une ligne par encaissement. Lisible et modifiable seulement par l'administrateur, avec la double authentification.
create table if not exists public.revenue_ledger (
  id uuid primary key default gen_random_uuid(),
  paid_on date not null,
  payer text not null check (char_length(btrim(payer)) between 1 and 120),
  nature text not null check (char_length(btrim(nature)) between 1 and 200),
  method text not null default 'Virement bancaire' check (char_length(method) between 1 and 40),
  ref text not null default '' check (char_length(ref) <= 80),
  gross numeric(12,2) not null check (gross >= 0 and gross < 10000000),
  fees numeric(12,2) not null default 0 check (fees >= 0 and fees <= gross),
  net numeric(12,2) generated always as (gross - fees) stored,
  note text not null default '' check (char_length(note) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists revenue_ledger_paid_on on public.revenue_ledger (paid_on, created_at);
alter table public.revenue_ledger enable row level security;
revoke all on public.revenue_ledger from public, anon, authenticated;

-- journal : chaque création, modification ou suppression est gardée (avant / après)
create table if not exists public.revenue_ledger_log (
  id bigint generated always as identity primary key,
  entry_id uuid not null,
  action text not null check (action in ('create', 'update', 'delete')),
  before jsonb,
  after jsonb,
  at timestamptz not null default now()
);
create index if not exists revenue_ledger_log_entry on public.revenue_ledger_log (entry_id, at);
alter table public.revenue_ledger_log enable row level security;
revoke all on public.revenue_ledger_log from public, anon, authenticated;

-- contrôle commun : ton compte + code à 6 chiffres ; sinon le refus est noté (comme pour les chiffres)
create or replace function public.admin_ok()
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare
  admin_id constant uuid := '8d8a867f-e766-41ca-b197-7694f5f5e1c4';
  me uuid := auth.uid();
begin
  if me is distinct from admin_id or coalesce(auth.jwt() ->> 'aal', '') <> 'aal2' then
    if (select count(*) from public.admin_access_log l where l.user_id is not distinct from me and l.at > now() - interval '1 hour') < 60 then
      insert into public.admin_access_log (user_id, reason)
      values (me, case when me is distinct from admin_id then 'autre compte' else 'sans code' end);
    end if;
    return false;
  end if;
  return true;
end $$;
revoke all on function public.admin_ok() from public, anon, authenticated;

create or replace function public.admin_denied()
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('denied', true, 'mfa', coalesce(auth.uid() = '8d8a867f-e766-41ca-b197-7694f5f5e1c4'::uuid, false));
$$;
revoke all on function public.admin_denied() from public, anon, authenticated;

create or replace function public.admin_ledger()
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.admin_ok() then return public.admin_denied(); end if;
  return jsonb_build_object(
    'rows', coalesce((select jsonb_agg(jsonb_build_object(
        'id', r.id, 'paid_on', r.paid_on, 'payer', r.payer, 'nature', r.nature, 'method', r.method, 'ref', r.ref,
        'gross', r.gross, 'fees', r.fees, 'net', r.net, 'note', r.note, 'created_at', r.created_at, 'updated_at', r.updated_at,
        'edits', (select count(*) from public.revenue_ledger_log l where l.entry_id = r.id and l.action = 'update'))
      order by r.paid_on, r.created_at) from public.revenue_ledger r), '[]'::jsonb),
    'deleted', (select count(*) from public.revenue_ledger_log where action = 'delete'),
    'at', now());
end $$;

create or replace function public.admin_ledger_save(entry jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  old_row public.revenue_ledger;
  new_row public.revenue_ledger;
  eid uuid := nullif(entry ->> 'id', '')::uuid;
  v_paid date := (entry ->> 'paid_on')::date;
  v_gross numeric := round((entry ->> 'gross')::numeric, 2);
  v_fees numeric := round(coalesce(nullif(entry ->> 'fees', ''), '0')::numeric, 2);
begin
  if not public.admin_ok() then return public.admin_denied(); end if;
  if v_paid is null or v_paid > current_date + 1 or v_paid < date '2020-01-01' then raise exception 'Date d''encaissement invalide'; end if;
  if eid is null then
    insert into public.revenue_ledger (paid_on, payer, nature, method, ref, gross, fees, note)
    values (v_paid, btrim(entry ->> 'payer'), btrim(entry ->> 'nature'), coalesce(nullif(btrim(entry ->> 'method'), ''), 'Virement bancaire'),
            coalesce(btrim(entry ->> 'ref'), ''), v_gross, v_fees, coalesce(btrim(entry ->> 'note'), ''))
    returning * into new_row;
    insert into public.revenue_ledger_log (entry_id, action, after) values (new_row.id, 'create', to_jsonb(new_row));
  else
    select * into old_row from public.revenue_ledger where id = eid for update;
    if not found then raise exception 'Recette introuvable'; end if;
    update public.revenue_ledger set paid_on = v_paid, payer = btrim(entry ->> 'payer'), nature = btrim(entry ->> 'nature'),
      method = coalesce(nullif(btrim(entry ->> 'method'), ''), 'Virement bancaire'), ref = coalesce(btrim(entry ->> 'ref'), ''),
      gross = v_gross, fees = v_fees, note = coalesce(btrim(entry ->> 'note'), ''), updated_at = now()
    where id = eid returning * into new_row;
    insert into public.revenue_ledger_log (entry_id, action, before, after) values (eid, 'update', to_jsonb(old_row), to_jsonb(new_row));
  end if;
  return jsonb_build_object('ok', true, 'id', new_row.id);
end $$;

create or replace function public.admin_ledger_delete(entry_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare old_row public.revenue_ledger;
begin
  if not public.admin_ok() then return public.admin_denied(); end if;
  delete from public.revenue_ledger where id = entry_id returning * into old_row;
  if not found then raise exception 'Recette introuvable'; end if;
  insert into public.revenue_ledger_log (entry_id, action, before) values (entry_id, 'delete', to_jsonb(old_row));
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.admin_ledger() from public, anon;
revoke all on function public.admin_ledger_save(jsonb) from public, anon;
revoke all on function public.admin_ledger_delete(uuid) from public, anon;
grant execute on function public.admin_ledger() to authenticated;
grant execute on function public.admin_ledger_save(jsonb) to authenticated;
grant execute on function public.admin_ledger_delete(uuid) to authenticated;

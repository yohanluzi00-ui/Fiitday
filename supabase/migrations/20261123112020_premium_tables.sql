create table if not exists public.app_config (
  id boolean primary key default true check (id),
  launch_at timestamptz,
  updated_at timestamptz not null default now()
);
insert into public.app_config (id) values (true) on conflict do nothing;
alter table public.app_config enable row level security;
revoke all on public.app_config from public, anon, authenticated;

create table if not exists public.entitlements (
  user_id uuid primary key references auth.users (id) on delete cascade,
  sub_kind text check (sub_kind in ('solo', 'family')),
  sub_until timestamptz,
  sub_store text check (char_length(sub_store) <= 30),
  sub_renews boolean,
  lifetime_kind text check (lifetime_kind in ('solo', 'family')),
  gift_kind text check (gift_kind in ('solo', 'family')),
  gift_until timestamptz,
  gift_note text not null default '' check (char_length(gift_note) <= 200),
  gift_at timestamptz,
  rc_event_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.entitlements enable row level security;
revoke all on public.entitlements from public, anon, authenticated;

create table if not exists public.trial_used (
  email_hash text primary key,
  at timestamptz not null default now()
);
alter table public.trial_used enable row level security;
revoke all on public.trial_used from public, anon, authenticated;

create or replace function public.email_hash(e text)
returns text language sql immutable set search_path = pg_catalog as $$
  select encode(sha256(convert_to(lower(btrim(coalesce(e, ''))), 'UTF8')), 'hex')
$$;
revoke all on function public.email_hash(text) from public, anon, authenticated;

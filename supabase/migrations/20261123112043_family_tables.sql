-- formule Famille : le titulaire invite jusqu'à 4 personnes, chacune garde son propre compte
create table if not exists public.families (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null unique references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  invites_blocked boolean not null default false,
  blocked_at timestamptz,
  block_note text not null default '' check (char_length(block_note) <= 200)
);
create table if not exists public.family_members (
  user_id uuid primary key references auth.users (id) on delete cascade,
  family_id uuid not null references public.families (id) on delete cascade,
  joined_at timestamptz not null default now()
);
create index if not exists family_members_family on public.family_members (family_id);
create table if not exists public.family_invites (
  code text primary key,
  family_id uuid not null references public.families (id) on delete cascade,
  label text not null default '' check (char_length(label) <= 40),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_by uuid,
  used_at timestamptz
);
create index if not exists family_invites_family on public.family_invites (family_id);
-- journal des arrivées et départs (gardé 12 mois) : sert aux places de 15 jours et à la surveillance
create table if not exists public.family_log (
  id bigint generated always as identity primary key,
  family_id uuid not null references public.families (id) on delete cascade,
  user_id uuid,
  action text not null check (action in ('create', 'invite', 'cancel', 'join', 'leave', 'remove', 'block', 'unblock')),
  at timestamptz not null default now()
);
create index if not exists family_log_family on public.family_log (family_id, at);
create index if not exists family_log_user on public.family_log (user_id, at);
-- codes d'invitation faux (limite d'essais)
create table if not exists public.family_tries (
  user_id uuid not null,
  at timestamptz not null default now()
);
create index if not exists family_tries_user on public.family_tries (user_id, at);
alter table public.families enable row level security;
alter table public.family_members enable row level security;
alter table public.family_invites enable row level security;
alter table public.family_log enable row level security;
alter table public.family_tries enable row level security;
revoke all on public.families, public.family_members, public.family_invites, public.family_log, public.family_tries from public, anon, authenticated;

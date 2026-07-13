-- Migration: 0001_profiles
-- Issue #81 — Accounts and profiles with Discord OAuth
-- ADR 006 (Supabase Hybrid Backend): identity + durable user data live in
-- Supabase Postgres with Row-Level Security. A player may only write their own
-- row; display fields are publicly readable so other players can render names
-- and avatars in a room.
--
-- Apply with:  supabase db push   (or paste into the Supabase SQL editor)
-- This migration is idempotent-ish (IF NOT EXISTS / DROP ... IF EXISTS guards)
-- so it is safe to re-run during setup.

-- ---------------------------------------------------------------------------
-- profiles: one row per authenticated user (id === auth.users.id)
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id           uuid        primary key references auth.users (id) on delete cascade,
  display_name text        not null default 'Player',
  avatar_url   text,
  -- Default dice color; keep in sync with DEFAULT_PLAYER_COLOR on the client.
  color        text        not null default '#8B5CF6',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table public.profiles is
  'Per-user profile (display name, avatar, default dice color). Seeded from Discord on first sign-in (#81).';

-- ---------------------------------------------------------------------------
-- Keep updated_at fresh on every write.
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row
  execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Row-Level Security
--   * Anyone (including anon) may READ display fields — a room renders other
--     players' names/avatars. The whole row is display-safe (no secrets).
--   * A user may INSERT / UPDATE / DELETE only their own row (id = auth.uid()).
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;

drop policy if exists "profiles are publicly readable" on public.profiles;
create policy "profiles are publicly readable"
  on public.profiles
  for select
  using (true);

drop policy if exists "users insert their own profile" on public.profiles;
create policy "users insert their own profile"
  on public.profiles
  for insert
  with check (auth.uid() = id);

drop policy if exists "users update their own profile" on public.profiles;
create policy "users update their own profile"
  on public.profiles
  for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

drop policy if exists "users delete their own profile" on public.profiles;
create policy "users delete their own profile"
  on public.profiles
  for delete
  using (auth.uid() = id);

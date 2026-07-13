-- Migration: 0002_user_data
-- Issue #82 — Server-side inventory and settings sync
-- ADR 006 (Supabase Hybrid Backend): durable user data (inventory, saved rolls,
-- settings) lives in Supabase Postgres with Row-Level Security. A player may
-- only read/write their OWN rows — none of this data is public (unlike
-- `profiles`, which exposes display fields to a room).
--
-- Schema shape — one JSONB blob per user per domain
-- --------------------------------------------------
-- Each table is keyed by `user_id` (one row per user) and stores the domain's
-- state as a single `data` JSONB column. This intentionally mirrors how the
-- client already persists each Zustand store (zustand/persist serializes each
-- domain to ONE versioned JSON blob in localStorage). Rationale:
--   * The client reads/writes each domain wholesale; the server never needs to
--     query or mutate individual dice / rolls, so a normalized row-per-die table
--     would add write churn and duplicate the client's schema-version + migrate
--     logic for zero query benefit at this app's scale.
--   * The client's `version` / `migrate` handling (Frontend-ADR-002) stays the
--     single source of truth for shape evolution; the blob rides along untouched.
--   * Last-write-wins conflict resolution keys off `updated_at`; a whole-blob
--     row makes that trivially correct (no partial-row merge semantics).
--
-- Apply with:  supabase db push   (or paste into the Supabase SQL editor).
-- Idempotent (IF NOT EXISTS / DROP ... IF EXISTS guards) — safe to re-run.

-- ---------------------------------------------------------------------------
-- Shared updated_at trigger function (also defined in 0001; re-create so this
-- migration is self-contained and order-independent).
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

-- ---------------------------------------------------------------------------
-- Helper: apply the standard own-row RLS + updated_at trigger to a user-data
-- table. Expressed inline per-table below (plpgsql DO blocks) so the whole
-- migration is a plain SQL script with no external dependencies.
-- ---------------------------------------------------------------------------

-- ===========================================================================
-- inventory: dice collection, currency, and saved-roll slot assignments.
-- data blob mirrors useInventoryStore partialize: { v, dice, currency, assignments }
-- ===========================================================================
create table if not exists public.inventory (
  user_id    uuid        primary key references auth.users (id) on delete cascade,
  data       jsonb       not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

comment on table public.inventory is
  'Per-user dice inventory blob (#82). Mirrors useInventoryStore persisted state; own-row RLS.';

drop trigger if exists inventory_set_updated_at on public.inventory;
create trigger inventory_set_updated_at
  before update on public.inventory
  for each row execute function public.set_updated_at();

alter table public.inventory enable row level security;

drop policy if exists "users read their own inventory" on public.inventory;
create policy "users read their own inventory"
  on public.inventory for select using (auth.uid() = user_id);

drop policy if exists "users insert their own inventory" on public.inventory;
create policy "users insert their own inventory"
  on public.inventory for insert with check (auth.uid() = user_id);

drop policy if exists "users update their own inventory" on public.inventory;
create policy "users update their own inventory"
  on public.inventory for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "users delete their own inventory" on public.inventory;
create policy "users delete their own inventory"
  on public.inventory for delete using (auth.uid() = user_id);

-- ===========================================================================
-- saved_rolls: the player's saved/favorite dice rolls.
-- data blob mirrors useSavedRollsStore: { v, savedRolls }
-- ===========================================================================
create table if not exists public.saved_rolls (
  user_id    uuid        primary key references auth.users (id) on delete cascade,
  data       jsonb       not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

comment on table public.saved_rolls is
  'Per-user saved dice rolls blob (#82). Mirrors useSavedRollsStore persisted state; own-row RLS.';

drop trigger if exists saved_rolls_set_updated_at on public.saved_rolls;
create trigger saved_rolls_set_updated_at
  before update on public.saved_rolls
  for each row execute function public.set_updated_at();

alter table public.saved_rolls enable row level security;

drop policy if exists "users read their own saved_rolls" on public.saved_rolls;
create policy "users read their own saved_rolls"
  on public.saved_rolls for select using (auth.uid() = user_id);

drop policy if exists "users insert their own saved_rolls" on public.saved_rolls;
create policy "users insert their own saved_rolls"
  on public.saved_rolls for insert with check (auth.uid() = user_id);

drop policy if exists "users update their own saved_rolls" on public.saved_rolls;
create policy "users update their own saved_rolls"
  on public.saved_rolls for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "users delete their own saved_rolls" on public.saved_rolls;
create policy "users delete their own saved_rolls"
  on public.saved_rolls for delete using (auth.uid() = user_id);

-- ===========================================================================
-- settings: durable, cross-device user preferences.
-- data blob mirrors useSettingsStore: { v, themeId }
-- (Device-ergonomic prefs like haptics/motion are intentionally NOT synced.)
-- ===========================================================================
create table if not exists public.settings (
  user_id    uuid        primary key references auth.users (id) on delete cascade,
  data       jsonb       not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

comment on table public.settings is
  'Per-user durable settings blob (#82), e.g. selected theme. Own-row RLS.';

drop trigger if exists settings_set_updated_at on public.settings;
create trigger settings_set_updated_at
  before update on public.settings
  for each row execute function public.set_updated_at();

alter table public.settings enable row level security;

drop policy if exists "users read their own settings" on public.settings;
create policy "users read their own settings"
  on public.settings for select using (auth.uid() = user_id);

drop policy if exists "users insert their own settings" on public.settings;
create policy "users insert their own settings"
  on public.settings for insert with check (auth.uid() = user_id);

drop policy if exists "users update their own settings" on public.settings;
create policy "users update their own settings"
  on public.settings for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "users delete their own settings" on public.settings;
create policy "users delete their own settings"
  on public.settings for delete using (auth.uid() = user_id);

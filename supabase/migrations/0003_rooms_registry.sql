-- Migration: 0003_rooms_registry
-- Issue #83 — dev-box room-server registry (ADR 006, Supabase Hybrid Backend)
--
-- The public room browser is driven by this `rooms` table, which supersedes any
-- ad-hoc discovery. Each dev-box Axum room server upserts one row keyed by its
-- INSTANCE_ID on startup and heartbeats every ~30s (see server/src/registry.rs).
-- A DB trigger stamps `last_heartbeat = now()` on every write, so a server that
-- dies simply stops refreshing and its row goes stale — the client browser
-- filters/prunes stale rows the same way the server prunes idle rooms in memory
-- (Server-ADR-001).
--
-- Row-Level Security:
--   * Anyone (incl. anon) may READ — the room browser is a public-read query.
--   * Writes are SERVICE-ROLE ONLY. The service_role key bypasses RLS entirely,
--     and NO insert/update/delete policy is granted to anon/authenticated, so a
--     player's anon/JWT session can never forge or tamper with a registry row.
--     The service-role key is an owner-provided secret (never committed, ADR 006)
--     supplied to the room server via env (SUPABASE_SERVICE_ROLE_KEY).
--
-- NOTE: migration 0002 is RESERVED by sibling work (#82); this is 0003.
--
-- Apply with:  supabase db push   (or paste into the Supabase SQL editor)
-- Idempotent-ish (IF NOT EXISTS / DROP ... IF EXISTS guards); safe to re-run.

-- ---------------------------------------------------------------------------
-- rooms: one row per live dev-box room server, keyed by INSTANCE_ID.
-- ---------------------------------------------------------------------------
create table if not exists public.rooms (
  -- The server's 8-char nanoid INSTANCE_ID (Server-ADR-001). Primary key so the
  -- heartbeat is an idempotent upsert (on_conflict=instance_id).
  instance_id    text        primary key,
  -- Publicly reachable base URL of this server (behind the TLS reverse proxy),
  -- e.g. https://rooms.example.com — what the client room browser connects to.
  public_url     text        not null,
  -- Optional human-friendly server label for the browser UI.
  name           text,
  -- Current aggregate player count across all rooms on this server.
  player_count   integer     not null default 0,
  -- Current number of live rooms on this server.
  room_count     integer     not null default 0,
  -- DB-stamped on every insert/update by the trigger below (never sent by the
  -- server) so freshness is authoritative and immune to dev-box clock skew.
  last_heartbeat timestamptz not null default now(),
  created_at     timestamptz not null default now()
);

comment on table public.rooms is
  'Registry of live dev-box room servers for the public room browser (#83). Rows are upserted by each server on an INSTANCE_ID-keyed heartbeat; stale rows (old last_heartbeat) are treated as dead.';

-- Index to make "fresh rooms" queries (order by / filter on last_heartbeat) cheap.
create index if not exists rooms_last_heartbeat_idx
  on public.rooms (last_heartbeat desc);

-- ---------------------------------------------------------------------------
-- Stamp last_heartbeat = now() on every write (reuses set_updated_at's shape
-- but targets last_heartbeat; defined standalone so this migration is
-- self-contained and order-independent from 0001).
-- ---------------------------------------------------------------------------
create or replace function public.set_last_heartbeat()
returns trigger
language plpgsql
as $$
begin
  new.last_heartbeat = now();
  return new;
end;
$$;

drop trigger if exists rooms_set_last_heartbeat on public.rooms;
create trigger rooms_set_last_heartbeat
  before insert or update on public.rooms
  for each row
  execute function public.set_last_heartbeat();

-- ---------------------------------------------------------------------------
-- Row-Level Security: public read, service-role-only write.
-- ---------------------------------------------------------------------------
alter table public.rooms enable row level security;

drop policy if exists "rooms are publicly readable" on public.rooms;
create policy "rooms are publicly readable"
  on public.rooms
  for select
  using (true);

-- No insert/update/delete policies are defined: only the service_role key
-- (which bypasses RLS) may write. This is deliberate — the room browser is
-- read-only for clients; registration is a server-side, service-role action.

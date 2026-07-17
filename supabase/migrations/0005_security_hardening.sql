-- Migration: 0005_security_hardening
-- Hosted Supabase advisor follow-up after the initial collectible catalog
-- deployment. This migration narrows the legacy table API surface, hardens
-- trigger helpers, and makes authenticated RLS lookups init-plan friendly.
--
-- The collectible catalog remains append-only. This migration does not change
-- any catalog identity, asset snapshot, or entitlement grant.

-- ---------------------------------------------------------------------------
-- Explicit table privileges.
--
-- Supabase projects may carry broad grants from their historical default ACLs.
-- Reset each existing application table before restoring only its intended API
-- surface. `service_role` keeps normal DML for trusted backend maintenance, but
-- receives no TRUNCATE, REFERENCES, or TRIGGER privilege.
-- ---------------------------------------------------------------------------
revoke all on table public.profiles from public, anon, authenticated, service_role;
revoke all on table public.inventory from public, anon, authenticated, service_role;
revoke all on table public.saved_rolls from public, anon, authenticated, service_role;
revoke all on table public.settings from public, anon, authenticated, service_role;
revoke all on table public.rooms from public, anon, authenticated, service_role;

-- Profile display fields and the room registry are public-read APIs.
grant select on table public.profiles to anon;
grant select on table public.profiles to authenticated;
grant select on table public.rooms to anon;
grant select on table public.rooms to authenticated;

-- Signed-in clients create and synchronize only rows authorized by RLS.
grant insert, update, delete on table public.profiles to authenticated;
grant select, insert, update, delete on table public.inventory to authenticated;
grant select, insert, update, delete on table public.saved_rolls to authenticated;
grant select, insert, update, delete on table public.settings to authenticated;

-- Trusted backend code retains the server-side write surface. RLS remains the
-- client boundary; the service-role key must never be shipped to a browser.
grant select, insert, update, delete on table public.profiles to service_role;
grant select, insert, update, delete on table public.inventory to service_role;
grant select, insert, update, delete on table public.saved_rolls to service_role;
grant select, insert, update, delete on table public.settings to service_role;
grant select, insert, update, delete on table public.rooms to service_role;

-- ---------------------------------------------------------------------------
-- Trigger helper hardening.
--
-- Trigger execution does not require the invoking DML role to hold direct
-- EXECUTE on the trigger function. Pin resolution to pg_catalog-only implicit
-- lookup and remove the unnecessary Data API callable surface.
-- ---------------------------------------------------------------------------
alter function public.set_updated_at() set search_path = '';
alter function public.set_last_heartbeat() set search_path = '';

revoke execute on function public.set_updated_at() from public, anon, authenticated;
revoke execute on function public.set_last_heartbeat() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- RLS init-plan optimization.
--
-- Wrapping auth.uid() in SELECT lets Postgres evaluate it once per statement
-- instead of once per candidate row. Restrict own-row policies to the signed-in
-- role while retaining the separate public-read policies for profiles/rooms.
-- ---------------------------------------------------------------------------
alter policy "users insert their own profile"
  on public.profiles
  to authenticated
  with check ((select auth.uid()) = id);

alter policy "users update their own profile"
  on public.profiles
  to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

alter policy "users delete their own profile"
  on public.profiles
  to authenticated
  using ((select auth.uid()) = id);

alter policy "users read their own inventory"
  on public.inventory
  to authenticated
  using ((select auth.uid()) = user_id);

alter policy "users insert their own inventory"
  on public.inventory
  to authenticated
  with check ((select auth.uid()) = user_id);

alter policy "users update their own inventory"
  on public.inventory
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

alter policy "users delete their own inventory"
  on public.inventory
  to authenticated
  using ((select auth.uid()) = user_id);

alter policy "users read their own saved_rolls"
  on public.saved_rolls
  to authenticated
  using ((select auth.uid()) = user_id);

alter policy "users insert their own saved_rolls"
  on public.saved_rolls
  to authenticated
  with check ((select auth.uid()) = user_id);

alter policy "users update their own saved_rolls"
  on public.saved_rolls
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

alter policy "users delete their own saved_rolls"
  on public.saved_rolls
  to authenticated
  using ((select auth.uid()) = user_id);

alter policy "users read their own settings"
  on public.settings
  to authenticated
  using ((select auth.uid()) = user_id);

alter policy "users insert their own settings"
  on public.settings
  to authenticated
  with check ((select auth.uid()) = user_id);

alter policy "users update their own settings"
  on public.settings
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

alter policy "users delete their own settings"
  on public.settings
  to authenticated
  using ((select auth.uid()) = user_id);

alter policy "users read their own entitlements"
  on public.user_entitlements
  to authenticated
  using ((select auth.uid()) = user_id and revoked_at is null);

-- PostgreSQL does not automatically index the referencing side of a foreign
-- key. The existing user-first indexes cannot support catalog-item cascades or
-- reverse ownership lookups because catalog_item_id is not their leading key.
create index if not exists user_entitlements_catalog_item_id_idx
  on public.user_entitlements (catalog_item_id);

comment on index public.user_entitlements_catalog_item_id_idx is
  'Foreign-key and reverse-ownership lookup path with catalog_item_id as the leading key; expected to be cold on a new deployment.';

-- ---------------------------------------------------------------------------
-- Accepted advisor notices.
--
-- The hosted project is new, so purpose-built indexes legitimately have no
-- scan history yet. Persist the operational rationale in the database catalog
-- so a future advisor review can distinguish cold indexes from dead indexes.
-- ---------------------------------------------------------------------------
comment on index public.rooms_last_heartbeat_idx is
  'Accepted unused-index notice on a new deployment: supports public fresh-room filtering and heartbeat ordering.';

comment on index public.user_entitlements_active_user_idx is
  'Accepted unused-index notice on a new deployment: supports signed-in active-ownership reads by user under RLS.';

-- This RPC intentionally remains the sole authenticated entitlement write
-- boundary. SECURITY DEFINER is required because authenticated clients have no
-- direct entitlement INSERT grant or policy. The function takes no arguments,
-- derives the user from auth.uid(), uses a fixed server-owned eight-item list,
-- has an empty search_path, is idempotent, and authenticated is its only
-- normal-client execution role (0004). Keeping it in public is required for
-- PostgREST RPC discovery; those constraints make the advisor notice an
-- accepted exception.
comment on function public.ensure_starter_entitlements() is
  'Accepted SECURITY DEFINER RPC: authenticated is the only client role, with no arguments, an auth.uid-bound fixed starter allowlist, an empty search_path, and no direct client entitlement writes.';

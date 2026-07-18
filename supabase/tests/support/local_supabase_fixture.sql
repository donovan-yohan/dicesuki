create schema auth;

do $$
begin
  create role anon nologin;
exception when duplicate_object then
  null;
end;
$$;

do $$
begin
  create role authenticated nologin;
exception when duplicate_object then
  null;
end;
$$;

do $$
begin
  create role service_role nologin bypassrls;
exception when duplicate_object then
  null;
end;
$$;

create table auth.users (
  id uuid primary key
);

-- Supabase provisions an empty `supabase_realtime` publication by default;
-- migrations add tables to it to stream row changes to subscribed clients. The
-- bare Postgres test image has none, so model the default here for parity.
do $$
begin
  create publication supabase_realtime;
exception when duplicate_object then
  null;
end;
$$;

create or replace function auth.uid()
returns uuid
language sql
stable
set search_path = ''
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
  )::uuid;
$$;

create or replace function auth.jwt()
returns jsonb
language sql
stable
set search_path = ''
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb,
    jsonb_build_object(
      'sub', nullif(current_setting('request.jwt.claim.sub', true), ''),
      'is_anonymous', false
    )
  );
$$;

grant usage on schema auth, public to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
grant execute on function auth.jwt() to anon, authenticated, service_role;

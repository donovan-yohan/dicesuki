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

grant usage on schema auth, public to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;

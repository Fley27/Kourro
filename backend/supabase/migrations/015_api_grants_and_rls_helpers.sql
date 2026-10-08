-- 015: make the PostgREST API actually usable on a freshly-created schema.
--
-- 1. The tenant helpers run inside RLS policies that read store_members, so
--    without SECURITY DEFINER every read on a tenant table recurses forever
--    (PostgREST: "stack depth limit exceeded").
-- 2. Recreating `public` (DROP/CREATE SCHEMA) drops the grants Supabase ships
--    with, so anon/authenticated/service_role lose all table access.

create or replace function auth_user_store_ids()
returns uuid[]
language sql stable security definer
set search_path = public
as $$
  select coalesce(array_agg(store_id), '{}')
  from store_members
  where user_id = auth.uid();
$$;

create or replace function is_org_member(org uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1
    from store_members sm
    join stores s on s.id = sm.store_id
    where sm.user_id = auth.uid()
      and s.organization_id = org
  ) or exists (
    select 1 from organizations o where o.id = org and o.owner_id = auth.uid()
  );
$$;

grant usage on schema public to anon, authenticated, service_role;
grant all on all tables in schema public to anon, authenticated, service_role;
grant all on all sequences in schema public to anon, authenticated, service_role;
grant execute on all functions in schema public to anon, authenticated, service_role;

alter default privileges in schema public
  grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public
  grant execute on functions to anon, authenticated, service_role;

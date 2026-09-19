-- Retail Sales Management — Organizations / Locations / Plans / Subscriptions
-- Tenant model: owner -> organization -> up to N store locations.
-- Catalog (products/categories) is organization-wide; inventory stays per-store.

-- ========== ORGANIZATIONS ==========
create table organizations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles(id) on delete cascade,
  name text not null,
  currency text not null default 'HTG',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_organizations_updated before update on organizations for each row execute function set_updated_at();

-- ========== PLANS ==========
create table plans (
  code text primary key,
  name text not null,
  max_locations integer not null,
  max_accounts integer not null,
  role_limits jsonb,
  desktop_app boolean not null default false,
  pro_email boolean not null default false,
  website_discount_pct integer not null default 0,
  local_network boolean not null default false
);

-- ========== SUBSCRIPTIONS ==========
create table subscriptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  plan_code text not null references plans(code),
  status text not null check (status in ('trial','active','paused','cancelled')),
  trial_ends_at timestamptz,
  started_at timestamptz not null default now(),
  renews_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_subscriptions_org on subscriptions(organization_id, status);
create trigger trg_subscriptions_updated before update on subscriptions for each row execute function set_updated_at();

-- ========== STORES GAIN ORGANIZATION ==========
alter table stores add column organization_id uuid references organizations(id) on delete set null;
create index idx_stores_org on stores(organization_id);

-- ========== PROFILES: org + authenticated-role scoping ==========
-- Drop the old role check (owner/manager/cashier) and re-add with admin.
alter table profiles drop constraint if exists profiles_role_check;
alter table profiles add constraint profiles_role_check check (role in ('owner','admin','manager','cashier'));
alter table profiles add column organization_id uuid references organizations(id) on delete set null;

-- ========== STORE_MEMBERS: allow admin + expose org ==========
alter table store_members drop constraint if exists store_members_role_check;
alter table store_members add constraint store_members_role_check check (role in ('owner','admin','manager','cashier'));
alter table store_members add column organization_id uuid references organizations(id) on delete cascade;

-- ========== SEED PLANS ==========
insert into plans (code, name, max_locations, max_accounts, role_limits, desktop_app, pro_email, website_discount_pct, local_network) values
  ('basic', 'Basic', 1, 3, '{"admin":1,"manager":1,"cashier":1}', false, false, 0, false),
  ('pro', 'Pro', 3, 8, '{"admin":2,"manager":3,"cashier":3}', false, false, 0, false),
  ('exclusive', 'Exclusive', 3, 8, null, true, true, 30, true)
on conflict (code) do nothing;

-- ========== CATALOG: products/categories become organization-scoped ==========
-- store_id stays NOT NULL for backwards-compat; organization_id becomes the
-- real catalog boundary (shared across locations).
alter table categories add column organization_id uuid references organizations(id) on delete cascade;
alter table products add column organization_id uuid references organizations(id) on delete cascade;

-- ========== RLS: helper + per-row tenant checks ==========
-- A user's effective stores = stores they belong to via store_members.
create or replace function auth_user_store_ids()
returns uuid[]
language sql stable
as $$
  select coalesce(array_agg(store_id), '{}')
  from store_members
  where user_id = auth.uid();
$$;

create or replace function is_org_member(org uuid)
returns boolean
language sql stable
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

-- Tighten existing permissive policies to store-membership scoping.
alter table stores enable row level security;
alter table organizations enable row level security;
alter table plans enable row level security;
alter table subscriptions enable row level security;
alter table store_members enable row level security;

drop policy if exists "allow_all_service" on stores;
create policy "stores_tenant" on stores for all
  using (id = any (auth_user_store_ids()))
  with check (id = any (auth_user_store_ids()));

-- Service role bypasses RLS; keep a broad policy for authenticated owners' orgs.
create policy "orgs_owner" on organizations for all
  using (owner_id = auth.uid() or is_org_member(id))
  with check (owner_id = auth.uid());

-- Plans are public catalog (so clients can show entitlements).
create policy "plans_read" on plans for select using (true);

create policy "subs_tenant" on subscriptions for all
  using (exists (select 1 from organizations o where o.id = organization_id and (o.owner_id = auth.uid() or is_org_member(o.id))))
  with check (exists (select 1 from organizations o where o.id = organization_id and (o.owner_id = auth.uid() or is_org_member(o.id))));

create policy "members_tenant" on store_members for all
  using (store_id = any (auth_user_store_ids()))
  with check (store_id = any (auth_user_store_ids()));

-- Operational tables: scope to user's stores.
alter table categories enable row level security;
alter table products enable row level security;
alter table customers enable row level security;
alter table sales enable row level security;
alter table sale_items enable row level security;
alter table credits enable row level security;
alter table credit_payments enable row level security;
alter table cash_sessions enable row level security;
alter table stock_movements enable row level security;
alter table price_history enable row level security;

drop policy if exists "allow_all_service_products" on products;
drop policy if exists "allow_all_service_sales" on sales;
drop policy if exists "allow_all_service_profiles" on profiles;

-- A user can read/write their own profile; a profile is created at signup by the
-- new user themselves (owner_id/email are theirs), so self-scope is sufficient.
create policy "profiles_self" on profiles for all
  using (id = auth.uid())
  with check (id = auth.uid());

create policy "categories_tenant" on categories for all
  using (store_id = any (auth_user_store_ids()) or is_org_member(organization_id))
  with check (store_id = any (auth_user_store_ids()) or is_org_member(organization_id));

create policy "products_tenant" on products for all
  using (store_id = any (auth_user_store_ids()) or is_org_member(organization_id))
  with check (store_id = any (auth_user_store_ids()) or is_org_member(organization_id));

create policy "customers_tenant" on customers for all
  using (store_id = any (auth_user_store_ids()))
  with check (store_id = any (auth_user_store_ids()));

create policy "sales_tenant" on sales for all
  using (store_id = any (auth_user_store_ids()))
  with check (store_id = any (auth_user_store_ids()));

create policy "sale_items_tenant" on sale_items for all
  using (store_id = any (auth_user_store_ids()))
  with check (store_id = any (auth_user_store_ids()));

create policy "credits_tenant" on credits for all
  using (store_id = any (auth_user_store_ids()))
  with check (store_id = any (auth_user_store_ids()));

create policy "credit_payments_tenant" on credit_payments for all
  using (store_id = any (auth_user_store_ids()))
  with check (store_id = any (auth_user_store_ids()));

create policy "cash_sessions_tenant" on cash_sessions for all
  using (store_id = any (auth_user_store_ids()))
  with check (store_id = any (auth_user_store_ids()));

create policy "stock_movements_tenant" on stock_movements for all
  using (store_id = any (auth_user_store_ids()))
  with check (store_id = any (auth_user_store_ids()));

create policy "price_history_tenant" on price_history for all
  using (store_id = any (auth_user_store_ids()))
  with check (store_id = any (auth_user_store_ids()));
-- 023 TENANT SCOPING
--
-- A tenant is a business (organizations). Inside a business:
--   business-wide : suppliers, catalog, clients + their debts — every store sees them
--   per store     : sales/shifts/tabs, inventory, batches, price history
--
-- Until now only products/categories carried organization_id, so "shared by the
-- whole business" was impossible to express for clients and suppliers, stock
-- lived as one scalar on the shared product row, and batches had no store
-- dimension at all. This migration adds the missing columns, backfills them
-- from stores, and introduces product_stock — the per-store quantity that
-- replaces products.stock_quantity (which stays as a deprecated cache).
--
-- Idempotent-ish by convention: `if not exists` everywhere, guarded trigger,
-- `drop policy if exists` before each create — the runner re-applies every
-- file on each `npm run migrate` and skips the whole file on a duplicate-object
-- error (see backend/src/migrate.ts).

-- ========== 1. organization_id on business-wide tables ==========

alter table public.customers
  add column if not exists organization_id uuid references public.organizations(id) on delete set null;
alter table public.suppliers
  add column if not exists organization_id uuid references public.organizations(id) on delete set null;
alter table public.supplier_bank_accounts
  add column if not exists organization_id uuid references public.organizations(id) on delete set null;

-- Backfill: every existing row belongs to the org of the store that created it.
update public.customers c
set organization_id = s.organization_id
from public.stores s
where c.store_id = s.id
  and c.organization_id is null
  and s.organization_id is not null;

update public.suppliers sup
set organization_id = s.organization_id
from public.stores s
where sup.store_id = s.id::text
  and sup.organization_id is null
  and s.organization_id is not null;

update public.supplier_bank_accounts sba
set organization_id = s.organization_id
from public.stores s
where sba.store_id = s.id::text
  and sba.organization_id is null
  and s.organization_id is not null;

create index if not exists idx_customers_org on public.customers(organization_id);
create index if not exists idx_suppliers_org on public.suppliers(organization_id);
create index if not exists idx_sba_org on public.supplier_bank_accounts(organization_id);

-- ========== 2. batches.store_id (both batch tables are per store) ==========

alter table public.batches
  add column if not exists store_id uuid references public.stores(id) on delete set null;

-- Backfill: a purchase batch lands at the store of the product it bought.
update public.batches b
set store_id = p.store_id
from public.items i
join public.products p on p.id::text = i.product_id
where b.item_id = i.id
  and b.store_id is null;

create index if not exists idx_batches_store on public.batches(store_id);

-- ========== 3. product_stock — per-store inventory ==========

create table if not exists public.product_stock (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  quantity numeric(16,4) not null default 0,
  available numeric(16,4) not null default 0,
  device_id text,
  lamport_clock integer not null default 0,
  is_deleted boolean not null default false,
  dirty integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id, product_id)
);

do $$
begin
  if not exists (
    select 1 from pg_trigger where tgname = 'trg_product_stock_updated'
  ) then
    create trigger trg_product_stock_updated
      before update on public.product_stock
      for each row execute function set_updated_at();
  end if;
end $$;

-- Seed each product's current scalar onto the store that owns it.
insert into public.product_stock (store_id, product_id, quantity, available)
select p.store_id,
       p.id,
       coalesce(p.stock_quantity, 0),
       coalesce(p.current_amount_available, coalesce(p.stock_quantity, 0))
from public.products p
where p.is_deleted = false
on conflict (store_id, product_id) do nothing;

-- ========== 4. RLS (defense in depth — middleware uses the service role) ==========

-- "Any store of my business" — the business-wide visibility helper. SECURITY
-- DEFINER like auth_user_store_ids (015) so policies don't recurse.
create or replace function auth_org_store_ids()
returns uuid[]
language sql stable security definer
set search_path = public
as $$
  select coalesce(array_agg(s.id), '{}')
  from public.stores s
  where s.organization_id is not null
    and is_org_member(s.organization_id);
$$;
grant execute on function auth_org_store_ids() to anon, authenticated, service_role;

alter table public.product_stock enable row level security;
drop policy if exists "product_stock_tenant" on public.product_stock;
create policy "product_stock_tenant" on public.product_stock for all
  using (store_id = any (auth_user_store_ids()))
  with check (store_id = any (auth_user_store_ids()));

-- Clients are business-wide: any store of the org may read/update them.
drop policy if exists "customers_tenant" on public.customers;
create policy "customers_tenant" on public.customers for all
  using (store_id = any (auth_user_store_ids()) or is_org_member(organization_id))
  with check (store_id = any (auth_user_store_ids()) or is_org_member(organization_id));

-- Debts follow the client across the business's stores.
drop policy if exists "credits_tenant" on public.credits;
create policy "credits_tenant" on public.credits for all
  using (store_id = any (auth_user_store_ids()) or store_id = any (auth_org_store_ids()))
  with check (store_id = any (auth_user_store_ids()) or store_id = any (auth_org_store_ids()));

drop policy if exists "credit_payments_tenant" on public.credit_payments;
create policy "credit_payments_tenant" on public.credit_payments for all
  using (store_id = any (auth_user_store_ids()) or store_id = any (auth_org_store_ids()))
  with check (store_id = any (auth_user_store_ids()) or store_id = any (auth_org_store_ids()));

-- Purchase batches are per store (v2 system — the single receiving model).
alter table public.batches enable row level security;
drop policy if exists "batches_tenant" on public.batches;
create policy "batches_tenant" on public.batches for all
  using (store_id = any (auth_user_store_ids()))
  with check (store_id = any (auth_user_store_ids()));

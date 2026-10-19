-- 024: org scope for the business-wide catalog chain.
--
-- items/variants/variant_prices/bundles/bundle_prices/product_units/
-- product_supplier_costs/product_suppliers/product_categories/category_links
-- carry NO scope column, so sync had to ship them unscoped to every caller —
-- one business's catalog leaked into another's pulls. The catalog is
-- business-wide (one row-set per business), so the scope is organization_id,
-- backfilled through the item → product → store chain (category_links runs
-- through its child category's store).
--
-- Idempotent-ish by convention (see 023 / backend/src/migrate.ts).

alter table public.items
  add column if not exists organization_id uuid references public.organizations(id) on delete set null;
alter table public.variants
  add column if not exists organization_id uuid references public.organizations(id) on delete set null;
alter table public.variant_prices
  add column if not exists organization_id uuid references public.organizations(id) on delete set null;
alter table public.bundles
  add column if not exists organization_id uuid references public.organizations(id) on delete set null;
alter table public.bundle_prices
  add column if not exists organization_id uuid references public.organizations(id) on delete set null;
alter table public.product_units
  add column if not exists organization_id uuid references public.organizations(id) on delete set null;
alter table public.product_supplier_costs
  add column if not exists organization_id uuid references public.organizations(id) on delete set null;
alter table public.product_suppliers
  add column if not exists organization_id uuid references public.organizations(id) on delete set null;
alter table public.product_categories
  add column if not exists organization_id uuid references public.organizations(id) on delete set null;
alter table public.category_links
  add column if not exists organization_id uuid references public.organizations(id) on delete set null;

-- products.organization_id predates this migration but was never backfilled.
update public.products p
set organization_id = s.organization_id
from public.stores s
where p.store_id = s.id
  and p.organization_id is null
  and s.organization_id is not null;

update public.items i
set organization_id = p.organization_id
from public.products p
where i.product_id = p.id::text
  and i.organization_id is null
  and p.organization_id is not null;

update public.variants v
set organization_id = i.organization_id
from public.items i
where v.item_id = i.id
  and v.organization_id is null
  and i.organization_id is not null;

update public.variant_prices vp
set organization_id = v.organization_id
from public.variants v
where vp.variant_id = v.id
  and vp.organization_id is null
  and v.organization_id is not null;

update public.bundles b
set organization_id = v.organization_id
from public.variants v
where b.variant_id = v.id
  and b.organization_id is null
  and v.organization_id is not null;

update public.bundle_prices bp
set organization_id = b.organization_id
from public.bundles b
where bp.bundle_id = b.id
  and bp.organization_id is null
  and b.organization_id is not null;

update public.product_units pu
set organization_id = p.organization_id
from public.products p
where pu.product_id = p.id::text
  and pu.organization_id is null
  and p.organization_id is not null;

update public.product_supplier_costs psc
set organization_id = p.organization_id
from public.products p
where psc.product_id = p.id::text
  and psc.organization_id is null
  and p.organization_id is not null;

update public.product_suppliers psup
set organization_id = p.organization_id
from public.products p
where psup.product_id = p.id::text
  and psup.organization_id is null
  and p.organization_id is not null;

update public.product_categories pc
set organization_id = p.organization_id
from public.products p
where pc.product_id = p.id::text
  and pc.organization_id is null
  and p.organization_id is not null;

update public.category_links cl
set organization_id = s.organization_id
from public.categories c
join public.stores s on s.id = c.store_id
where cl.child_id = c.id::text
  and cl.organization_id is null
  and s.organization_id is not null;

create index if not exists idx_items_org on public.items(organization_id);
create index if not exists idx_variants_org on public.variants(organization_id);
create index if not exists idx_variant_prices_org on public.variant_prices(organization_id);
create index if not exists idx_bundles_org on public.bundles(organization_id);
create index if not exists idx_bundle_prices_org on public.bundle_prices(organization_id);
create index if not exists idx_product_units_org on public.product_units(organization_id);
create index if not exists idx_product_supplier_costs_org on public.product_supplier_costs(organization_id);
create index if not exists idx_product_suppliers_org on public.product_suppliers(organization_id);
create index if not exists idx_product_categories_org on public.product_categories(organization_id);
create index if not exists idx_category_links_org on public.category_links(organization_id);

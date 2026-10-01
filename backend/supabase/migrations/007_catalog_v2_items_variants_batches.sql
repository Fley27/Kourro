-- 007 Catalog v2: Product (abstract) → Item (container chain) →
-- Variant (presentation) → VariantPrice (effective-dated). Cost enters only
-- via batches. Follows 004/005/006 conventions: TEXT ids (mobile generates
-- them offline), lamport_clock LWW, soft delete, set_updated_at trigger.
-- All catalog tables are global (no store scope).

-- ========== ITEMS (purchasable containers, chain via ref_item) ==========
create table if not exists items (
  id text primary key,
  product_id text not null,
  name text not null,
  ref_item_id text,
  ratio numeric(16,6),
  sort_order integer not null default 0,
  device_id text,
  lamport_clock integer not null default 0,
  is_deleted boolean not null default false,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_items_product on items(product_id);
create trigger trg_items_updated before update on items for each row execute function set_updated_at();

-- ========== PRODUCT_SUPPLIERS (costless sourcing link) ==========
create table if not exists product_suppliers (
  id text primary key,
  product_id text not null,
  supplier_id text not null,
  device_id text,
  lamport_clock integer not null default 0,
  is_deleted boolean not null default false,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (product_id, supplier_id)
);
create index if not exists idx_product_suppliers_supplier on product_suppliers(supplier_id);
create trigger trg_product_suppliers_updated before update on product_suppliers for each row execute function set_updated_at();

-- ========== BATCHES (only place cost enters) ==========
create table if not exists batches (
  id text primary key,
  item_id text not null,
  supplier_id text not null,
  date date not null,
  quantity numeric(16,4) not null default 0,
  total_paid numeric(16,2) not null default 0,
  status text not null default 'pending',
  received_by text,
  received_at timestamptz,
  denied_by text,
  denied_at timestamptz,
  reason text,
  source text not null default 'user',
  device_id text,
  lamport_clock integer not null default 0,
  is_deleted boolean not null default false,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status in ('pending', 'received', 'denied'))
);
create index if not exists idx_batches_item on batches(item_id);
create index if not exists idx_batches_supplier on batches(supplier_id);
create trigger trg_batches_updated before update on batches for each row execute function set_updated_at();

-- ========== VARIANTS (sellable presentations of an item) ==========
create table if not exists variants (
  id text primary key,
  item_id text not null,
  name text not null,
  sort_order integer not null default 0,
  device_id text,
  lamport_clock integer not null default 0,
  is_deleted boolean not null default false,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_variants_item on variants(item_id);
create trigger trg_variants_updated before update on variants for each row execute function set_updated_at();

-- ========== VARIANT_PRICES (effective-dated, no is-current flag) ==========
create table if not exists variant_prices (
  id text primary key,
  variant_id text not null,
  price numeric(16,2) not null,
  date date not null,
  device_id text,
  lamport_clock integer not null default 0,
  is_deleted boolean not null default false,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_variant_prices_variant on variant_prices(variant_id);
create trigger trg_variant_prices_updated before update on variant_prices for each row execute function set_updated_at();

-- ========== BUNDLES re-keyed unit → variant ==========
alter table product_bundles add column if not exists variant_id text;

-- ========== PRODUCTS slimmed: cost basis now derives from batches ==========
alter table products drop column if exists cost_price;

-- ========== PRODUCTS draft status: unfinished chains never list ==========
alter table products add column if not exists status text not null default 'active';

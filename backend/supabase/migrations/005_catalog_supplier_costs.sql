-- 005 Catalog x Supplier: global suppliers, product_units.condition,
-- product_supplier_costs join, batch supplier link, complimentary flags.
-- Follows 004 conventions: TEXT ids (mobile generates them offline),
-- lamport_clock LWW, soft delete, set_updated_at trigger.

-- ========== SUPPLIERS GO GLOBAL ==========
-- Stores are locations of one business: same products, same suppliers.
-- Inventory (stock_batches) stays per-store. Keep store_id as legacy
-- (old rows), new rows write NULL; reads stop scoping by store.
alter table suppliers alter column store_id drop not null;

-- ========== PRODUCT UNITS: condition dimension ==========
-- Mobile already has product_units (per-product); server never did.
-- condition is the second variant dimension (cold / room temperature),
-- nullable: NULL = no condition. Label lives in unit_name.
create table if not exists product_units (
  id text primary key,
  product_id text not null,
  unit_name text not null,
  condition text,
  conversion_factor numeric(12,4) not null default 1,
  device_id text,
  lamport_clock integer not null default 0,
  is_deleted boolean not null default false,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_product_units_product on product_units(product_id);
-- NULL-safe uniqueness: (product, label, condition) with NULL = ''.
create unique index if not exists idx_product_units_unique
  on product_units(product_id, unit_name, (coalesce(condition, '')))
  where is_deleted = false;
create trigger trg_product_units_updated before update on product_units for each row execute function set_updated_at();

-- ========== PRODUCT_SUPPLIER_COSTS (global join) ==========
-- One row per (product, supplier, unit). Editing cost here never touches
-- sibling suppliers. No resell column: resell is one-per-unit and lives
-- wherever selling prices live (mobile product_prices). No store_id:
-- costs are business-wide, like products and suppliers.
create table if not exists product_supplier_costs (
  id text primary key,
  product_id text not null,
  supplier_id text not null,
  unit_id text not null,
  cost numeric(12,2) not null default 0 check (cost >= 0),
  last_updated timestamptz not null default now(),
  device_id text,
  lamport_clock integer not null default 0,
  is_deleted boolean not null default false,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (product_id, supplier_id, unit_id)
);
create index if not exists idx_psc_product on product_supplier_costs(product_id);
create index if not exists idx_psc_supplier on product_supplier_costs(supplier_id);
create index if not exists idx_psc_unit on product_supplier_costs(unit_id);
create trigger trg_psc_updated before update on product_supplier_costs for each row execute function set_updated_at();

-- ========== STOCK BATCHES: link to global supplier ==========
-- Legacy free-text supplier column kept for history; new receives write supplier_id.
alter table stock_batches add column if not exists supplier_id text;
create index if not exists idx_stock_batches_supplier on stock_batches(supplier_id);

-- ========== COMPLIMENTARY / PROMOTIONAL SALES ==========
-- Flag lives on the transaction, never on catalog tables. Stock still
-- deducts normally; revenue is zero. Whole-sale gratis = zero-total cash only.
alter table sales add column if not exists is_complimentary boolean not null default false;
alter table sales add column if not exists complimentary_reason text;
alter table sales add column if not exists approved_by text;
alter table sale_items add column if not exists is_complimentary boolean not null default false;
alter table sale_items add column if not exists approved_by text;
-- Gratis sales can never be credit/debt.
alter table sales drop constraint if exists sales_gratis_no_credit;
alter table sales add constraint sales_gratis_no_credit
  check (is_complimentary = false or (status != 'credit' and coalesce(amount_due, 0) = 0));
create index if not exists idx_sales_complimentary on sales(is_complimentary) where is_complimentary = true;

-- 004 New scope (Phases 1-8): suppliers, orders, employee Stores, catalog flags,
-- stock batches. Mirrors the offline-first mobile SQLite model: TEXT ids
-- (mobile generates them locally), so no uuid PKs / FKs here.

-- ========== SUPPLIERS (Founisè) ==========
-- bank_info is sensitive: only ever written by owner devices; Admins read masked.
create table if not exists suppliers (
  id text primary key,
  store_id text not null,
  name text not null,
  phone text,
  address text,
  payment_terms text,
  bank_info text,
  notes text,
  device_id text,
  lamport_clock integer not null default 0,
  is_deleted boolean not null default false,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_suppliers_store on suppliers(store_id);
create trigger trg_suppliers_updated before update on suppliers for each row execute function set_updated_at();

-- ========== ORDERS (Kòmand) ==========
-- requested -> approved -> ordered -> received (cancelled from any open state)
create table if not exists orders (
  id text primary key,
  store_id text not null,
  item_name text not null,
  qty numeric(12,2) not null default 1,
  unit text,
  supplier_name text,
  note text,
  status text not null default 'requested'
    check (status in ('requested','approved','ordered','received','cancelled')),
  requested_by text,
  requested_by_name text,
  approved_by text,
  device_id text,
  lamport_clock integer not null default 0,
  is_deleted boolean not null default false,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_orders_store on orders(store_id);
create index if not exists idx_orders_status on orders(store_id, status);
create trigger trg_orders_updated before update on orders for each row execute function set_updated_at();

-- ========== EMPLOYEE <-> STORE ASSIGNMENTS ==========
create table if not exists employee_stores (
  employee_id text not null,
  store_id text not null,
  device_id text,
  created_at timestamptz not null default now(),
  primary key (employee_id, store_id)
);
create index if not exists idx_employee_stores_store on employee_stores(store_id);

-- ========== PRODUCTS: catalog flags (Phase 2) ==========
alter table products add column if not exists item_type text not null default 'goods'
  check (item_type in ('goods','service'));
alter table products add column if not exists is_available boolean not null default true;
alter table products add column if not exists current_amount_available numeric(12,2) not null default 0;
update products set current_amount_available = stock_quantity where current_amount_available = 0;

-- ========== STOCK BATCHES (receiving) ==========
create table if not exists stock_batches (
  id text primary key,
  store_id text not null,
  reference text,
  supplier text,
  transport_cost numeric(12,2) not null default 0,
  notes text,
  total_items_cost numeric(12,2) not null default 0,
  total_cost numeric(12,2) not null default 0,
  received_at timestamptz,
  status text not null default 'pending',
  delivered_at timestamptz,
  created_by text,
  device_id text,
  lamport_clock integer not null default 0,
  is_deleted boolean not null default false,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_stock_batches_store on stock_batches(store_id);
create trigger trg_stock_batches_updated before update on stock_batches for each row execute function set_updated_at();

-- ========== STOCK MOVEMENTS: mobile columns + in/out types ==========
-- Mobile generates TEXT ids offline (mov-<ts>), so PK/FK columns become text.
alter table stock_movements drop constraint if exists stock_movements_product_id_fkey;
alter table stock_movements drop constraint if exists stock_movements_created_by_fkey;
alter table stock_movements alter column id type text using id::text;
alter table stock_movements alter column product_id type text using product_id::text;
alter table stock_movements alter column created_by type text using created_by::text;
alter table stock_movements alter column reference_id type text using reference_id::text;
alter table stock_movements add column if not exists batch_id text;
alter table stock_movements add column if not exists initial_qty numeric(12,2) not null default 0;
alter table stock_movements add column if not exists remaining_qty numeric(12,2) not null default 0;
alter table stock_movements add column if not exists unit_cost numeric(12,2) not null default 0;
alter table stock_movements add column if not exists total_cost numeric(12,2) not null default 0;
alter table stock_movements add column if not exists allocated_transport numeric(12,2) not null default 0;
alter table stock_movements add column if not exists status text not null default 'pending';
alter table stock_movements add column if not exists delivered_at timestamptz;
alter table stock_movements drop constraint if exists stock_movements_type_check;
alter table stock_movements add constraint stock_movements_type_check
  check (type in ('sale','purchase','adjustment','return','transfer','in','out'));
create index if not exists idx_stock_movements_batch on stock_movements(batch_id);

-- Retail Sales Management — Full Schema
-- Supabase / Postgres
-- Enable extensions
create extension if not exists "pgcrypto";
create extension if not exists "uuid-ossp";

-- Helper: updated_at trigger
create or replace function set_updated_at() returns trigger as $$
begin new.updated_at = now(); return new; end; $$ language plpgsql;

-- ========== STORES ==========
create table stores (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  address text,
  phone text,
  owner_id uuid,
  currency text not null default 'HTG',
  is_active boolean not null default true,
  device_id text,
  lamport_clock integer not null default 0,
  is_deleted boolean not null default false,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_stores_updated before update on stores for each row execute function set_updated_at();

-- ========== USERS (extends auth.users) ==========
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text not null,
  role text not null check (role in ('owner','manager','cashier')),
  language text not null default 'ht' check (language in ('ht','fr','en')),
  pin_code text check (pin_code ~ '^[0-9]{4}$'),
  device_id text,
  lamport_clock integer not null default 0,
  is_deleted boolean not null default false,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_profiles_updated before update on profiles for each row execute function set_updated_at();

create table store_members (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  role text not null check (role in ('owner','manager','cashier')),
  created_at timestamptz not null default now(),
  unique(store_id, user_id)
);

-- ========== CATEGORIES ==========
create table categories (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  name text not null,
  name_ht text,
  color text,
  device_id text,
  lamport_clock integer not null default 0,
  is_deleted boolean not null default false,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_categories_store on categories(store_id);
create trigger trg_categories_updated before update on categories for each row execute function set_updated_at();

-- ========== PRODUCTS ==========
create table products (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  sku text,
  barcode text,
  name text not null,
  name_ht text,
  category_id uuid references categories(id) on delete set null,
  unit text not null default 'pcs',
  cost_price numeric(12,2) not null default 0,
  selling_price numeric(12,2) not null default 0,
  stock_quantity numeric(12,2) not null default 0,
  low_stock_threshold numeric(12,2) not null default 5,
  image_url text,
  device_id text,
  lamport_clock integer not null default 0,
  is_deleted boolean not null default false,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_products_store on products(store_id);
create index idx_products_barcode on products(barcode);
create unique index idx_products_sku_store on products(store_id, sku) where sku is not null;
create trigger trg_products_updated before update on products for each row execute function set_updated_at();

-- ========== PRICE HISTORY ==========
create table price_history (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,
  old_cost numeric(12,2),
  new_cost numeric(12,2) not null,
  old_price numeric(12,2),
  new_price numeric(12,2) not null,
  reason text,
  changed_by uuid references profiles(id),
  device_id text,
  lamport_clock integer not null default 0,
  is_deleted boolean not null default false,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_price_history_product on price_history(product_id, created_at desc);

-- ========== CUSTOMERS ==========
create table customers (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  name text not null,
  phone text,
  address text,
  notes text,
  credit_limit numeric(12,2) not null default 0,
  total_debt numeric(12,2) not null default 0,
  device_id text,
  lamport_clock integer not null default 0,
  is_deleted boolean not null default false,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_customers_store on customers(store_id);
create index idx_customers_phone on customers(phone);

-- ========== SALES ==========
create table sales (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  sale_number text not null,
  customer_id uuid references customers(id) on delete set null,
  status text not null check (status in ('completed','pending','cancelled','credit')),
  payment_method text not null check (payment_method in ('cash','credit','mobile_money','mixed')),
  subtotal numeric(12,2) not null default 0,
  discount numeric(12,2) not null default 0,
  total numeric(12,2) not null default 0,
  amount_paid numeric(12,2) not null default 0,
  amount_due numeric(12,2) not null default 0,
  notes text,
  cashier_id uuid references profiles(id),
  device_id text,
  lamport_clock integer not null default 0,
  is_deleted boolean not null default false,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index idx_sales_number_store on sales(store_id, sale_number);
create index idx_sales_store_created on sales(store_id, created_at desc);
create trigger trg_sales_updated before update on sales for each row execute function set_updated_at();

create table sale_items (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  sale_id uuid not null references sales(id) on delete cascade,
  product_id uuid not null references products(id),
  product_name text not null,
  quantity numeric(12,2) not null,
  unit_price numeric(12,2) not null,
  cost_price numeric(12,2) not null,
  line_total numeric(12,2) not null,
  device_id text,
  lamport_clock integer not null default 0,
  is_deleted boolean not null default false,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_sale_items_sale on sale_items(sale_id);

-- ========== CREDIT ==========
create table credits (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  sale_id uuid not null references sales(id) on delete cascade,
  customer_id uuid not null references customers(id) on delete cascade,
  amount numeric(12,2) not null,
  amount_paid numeric(12,2) not null default 0,
  balance numeric(12,2) not null,
  due_date date,
  status text not null check (status in ('pending','partial','paid','overdue')),
  device_id text,
  lamport_clock integer not null default 0,
  is_deleted boolean not null default false,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_credits_customer on credits(customer_id);
create index idx_credits_status on credits(store_id, status);

create table credit_payments (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  credit_id uuid not null references credits(id) on delete cascade,
  amount numeric(12,2) not null,
  payment_method text not null check (payment_method in ('cash','credit','mobile_money','mixed')),
  received_by uuid references profiles(id),
  notes text,
  device_id text,
  lamport_clock integer not null default 0,
  is_deleted boolean not null default false,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ========== CASH SESSIONS ==========
create table cash_sessions (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  cashier_id uuid not null references profiles(id),
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  opening_balance numeric(12,2) not null default 0,
  closing_balance numeric(12,2),
  expected_balance numeric(12,2),
  discrepancy numeric(12,2),
  status text not null check (status in ('open','closed')),
  device_id text,
  lamport_clock integer not null default 0,
  is_deleted boolean not null default false,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ========== STOCK MOVEMENTS ==========
create table stock_movements (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,
  type text not null check (type in ('sale','purchase','adjustment','return','transfer')),
  quantity numeric(12,2) not null,
  reason text,
  reference_id uuid,
  created_by uuid references profiles(id),
  device_id text,
  lamport_clock integer not null default 0,
  is_deleted boolean not null default false,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_stock_movements_product on stock_movements(product_id, created_at desc);

-- ========== SYNC STATE ==========
create table sync_state (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id),
  device_id text not null,
  last_synced_at timestamptz,
  vector_clock jsonb not null default '{}'::jsonb,
  unique(store_id, device_id)
);

-- ========== VIEWS ==========
create or replace view v_profit_daily as
select
  s.store_id,
  date(s.created_at) as day,
  count(*) as sales_count,
  sum(s.total) as revenue,
  sum(si.cost_price * si.quantity) as total_cost,
  sum(s.total - si.cost_price * si.quantity) as gross_profit
from sales s
join sale_items si on si.sale_id = s.id
where s.status != 'cancelled' and s.is_deleted = false
group by s.store_id, date(s.created_at);

-- ========== RLS (enable, policies are permissive for service_role) ==========
alter table stores enable row level security;
alter table profiles enable row level security;
alter table products enable row level security;
alter table sales enable row level security;
-- For demo, allow authenticated to read/write own stores
-- In production, tighten with store_members checks
create policy "allow_all_service" on stores for all using (true) with check (true);
create policy "allow_all_service_profiles" on profiles for all using (true) with check (true);
create policy "allow_all_service_products" on products for all using (true) with check (true);
create policy "allow_all_service_sales" on sales for all using (true) with check (true);

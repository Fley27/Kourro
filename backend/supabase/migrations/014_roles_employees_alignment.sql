-- 014: align the server schema with the mobile SQLite model and rebuild the
-- staff/role model that the app actually uses.
--
-- 1. columns the mobile client already writes but the server never stored
-- 2. role list: the app uses six roles, the server only allowed four
-- 3. credits.sale_id nullable (the client can hold a credit whose sale row never existed)
-- 4. roles / role_permissions / employees

-- ========== 1. missing columns (SQLite -> Postgres) ==========
alter table batches add column if not exists dirty integer;
alter table bundle_prices add column if not exists dirty integer;
alter table bundles add column if not exists dirty integer;
alter table categories add column if not exists icon text;
alter table categories add column if not exists sort_order integer;
alter table categories add column if not exists dirty integer;
alter table category_links add column if not exists dirty integer;
alter table credit_payments add column if not exists collected_by text;
alter table credit_payments add column if not exists shift_id text;
alter table credits add column if not exists dirty integer;
alter table customers add column if not exists email text;
alter table customers add column if not exists first_name text;
alter table customers add column if not exists last_name text;
alter table customers add column if not exists birth_day text;
alter table customers add column if not exists birth_month text;
alter table customers add column if not exists birth_year text;
alter table customers add column if not exists country text;
alter table customers add column if not exists department text;
alter table customers add column if not exists commune text;
alter table customers add column if not exists address_line1 text;
alter table customers add column if not exists address_line2 text;
alter table customers add column if not exists marketing_consent integer;
alter table customers add column if not exists is_high_risk integer;
alter table customers add column if not exists open_debt_count integer;
alter table customers add column if not exists dirty integer;
alter table items add column if not exists dirty integer;
alter table open_orders add column if not exists customer_id text;
alter table open_orders add column if not exists ready_for_payment integer;
alter table open_orders add column if not exists ready_at text;
alter table open_orders add column if not exists ready_by text;
alter table orders add column if not exists dirty integer;
alter table product_supplier_costs add column if not exists dirty integer;
alter table product_suppliers add column if not exists dirty integer;
alter table products add column if not exists dirty integer;
alter table sale_items add column if not exists unit_id text;
alter table sale_items add column if not exists variant text;
alter table sale_items add column if not exists quantity_delivered double precision;
alter table sale_items add column if not exists dirty integer;
alter table sales add column if not exists seller_id text;
alter table sales add column if not exists seller_role text;
alter table sales add column if not exists standby integer;
alter table sales add column if not exists dirty integer;
alter table stores add column if not exists location text;
alter table stores add column if not exists code text;
alter table stores add column if not exists disabled integer;
alter table stores add column if not exists breach_flagged integer;
alter table stores add column if not exists breached_at text;
alter table stores add column if not exists revoked_by text;
alter table stores add column if not exists dirty integer;
alter table supplier_bank_accounts add column if not exists dirty integer;
alter table suppliers add column if not exists dirty integer;
alter table variant_prices add column if not exists dirty integer;
alter table variants add column if not exists dirty integer;

-- ========== 2. six roles ==========
alter table credits alter column sale_id drop not null;

alter table profiles drop constraint if exists profiles_role_check;
alter table profiles add constraint profiles_role_check
  check (role in ('owner','admin','manager','cashier','associate','cook'));

alter table store_members drop constraint if exists store_members_role_check;
alter table store_members add constraint store_members_role_check
  check (role in ('owner','admin','manager','cashier','associate','cook'));

-- ========== 3. roles ==========
create table if not exists roles (
  code text primary key,
  label text not null,
  rank integer not null,
  needs_hospitality boolean not null default false,
  assignable boolean not null default true,
  created_at timestamptz not null default now()
);

insert into roles (code, label, rank, needs_hospitality, assignable) values
  ('owner',     'Owner',     4, false, false),
  ('admin',     'Admin',     3, false, true),
  ('manager',   'Manager',   2, false, true),
  ('cashier',   'Cashier',   1, false, true),
  ('associate', 'Associate', 1, false, true),
  ('cook',      'Cook',      1, true,  true)
on conflict (code) do nothing;

-- ========== 4. role permissions ==========
-- Grounded in the permission checks that exist in the app today.
create table if not exists role_permissions (
  role_code text not null references roles(code) on delete cascade,
  permission text not null,
  created_at timestamptz not null default now(),
  primary key (role_code, permission)
);

insert into role_permissions (role_code, permission)
select r.role, g.permission
from (
  values
    ('manage_users',            array['owner','admin']),
    ('create_employee_role',    array['owner','admin']),
    ('change_employee_role',    array['owner','admin']),
    ('deactivate_employee',     array['owner','admin']),
    ('reset_staff_credentials', array['owner','admin']),
    ('see_salary',              array['owner','admin','manager','cashier','associate','cook']),
    ('see_all_stores',          array['owner']),
    ('manage_store',            array['owner','admin']),
    ('account_billing',         array['owner']),
    ('wipe_catalog',            array['owner']),
    ('view_reports',            array['owner','admin','manager']),
    ('review_daily_report',     array['owner','admin','manager']),
    ('log_deficit',             array['owner','admin','manager']),
    ('view_shift',              array['owner','admin','manager','cashier']),
    ('manage_catalog',          array['owner','admin','manager']),
    ('handle_batches',          array['owner','admin','manager']),
    ('inventory_write',         array['owner','admin','manager']),
    ('receive_delivery',        array['owner','admin','manager','cashier']),
    ('view_item_cost',          array['owner','admin']),
    ('reduce_stock',            array['owner','admin']),
    ('delete_catalog_item',     array['owner','admin']),
    ('toggle_availability',     array['owner','admin','manager','cook']),
    ('view_catalog',            array['owner','admin','manager','cashier','associate','cook']),
    ('view_customers',          array['owner','admin','manager','cashier','associate']),
    ('add_customer',            array['owner','admin','manager','cashier','associate']),
    ('edit_customer',           array['owner','admin','manager']),
    ('edit_credit_limit',       array['owner','admin','manager']),
    ('process_credit_sale',     array['owner','admin','manager']),
    ('register_customer_at_pos',array['owner','admin','manager','cashier','associate']),
    ('view_suppliers',          array['owner','admin']),
    ('write_supplier',          array['owner','admin']),
    ('delete_supplier',         array['owner']),
    ('view_supplier_costs',     array['owner','admin']),
    ('edit_supplier_costs',     array['owner','admin']),
    ('manage_promos',           array['owner','admin','manager']),
    ('view_proformat',          array['owner','admin','manager','cashier']),
    ('view_orders',             array['owner','admin','manager','cashier','cook']),
    ('view_pickups',            array['owner','admin','manager','cashier','cook']),
    ('pickup_toggle_manager',   array['owner','admin','manager']),
    ('order_line_decide',       array['owner','admin','manager','cook']),
    ('order_force_cancel',      array['owner','admin','manager']),
    ('approve_complimentary',   array['owner','admin','manager']),
    ('print_bill',              array['owner','admin','manager','cashier','cook']),
    ('supervisor_approvals',    array['owner','admin','manager']),
    ('pos_resume_any_tab',      array['owner','admin','manager']),
    ('view_transactions',       array['owner','admin','manager','cashier','associate','cook']),
    ('own_sales_only',          array['associate','cook'])
) as g(permission, roles), unnest(g.roles) as r(role)
on conflict do nothing;

-- ========== 5. employees ==========
create table if not exists employees (
  id uuid primary key,
  store_id uuid not null references stores(id) on delete cascade,
  full_name text not null,
  role text not null references roles(code),
  phone text,
  salary numeric(12,2) not null default 0,
  address text,
  language text not null default 'ht' check (language in ('ht','fr','en')),
  device_id text,
  is_active boolean not null default true,
  online_status boolean not null default false,
  lamport_clock integer not null default 0,
  is_deleted boolean not null default false,
  dirty integer,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_employees_store on employees(store_id);
create trigger trg_employees_updated before update on employees
  for each row execute function set_updated_at();

alter table employees enable row level security;
create policy "employees_tenant" on employees for all
  using (store_id = any(auth_user_store_ids()))
  with check (store_id = any(auth_user_store_ids()));

alter table roles enable row level security;
create policy "roles_read" on roles for select using (true);
alter table role_permissions enable row level security;
create policy "role_permissions_read" on role_permissions for select using (true);

-- ========== 6. client settings (mirrors the SQLite _meta table) ==========
create table if not exists client_settings (
  key text primary key,
  value text,
  updated_at timestamptz not null default now()
);
alter table client_settings enable row level security;
create policy "client_settings_service" on client_settings for all using (true) with check (true);


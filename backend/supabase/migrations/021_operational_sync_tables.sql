-- 021 OPERATIONAL SYNC TABLES
--
-- The rows that could only ever live on the device that wrote them: shifts,
-- daily reports, standby hands, suspended tabs (+ their lines), pickup events
-- and notifications. Until now they were queued in the outbox, rejected by the
-- push as `unknown_table`, and dropped — so a register never saw another
-- register's shift, report, tab or pickup.
--
-- Convention (013): TEXT ids minted on the device (tab lines are `${tab}_${i}`,
-- so never uuid), no FKs, soft delete, lamport_clock + dirty + updated_at for
-- LWW, store_id for scoping — except notifications, which are user-scoped and
-- have no store column (they sync unscoped, see NO_STORE_SCOPE in sync.ts).
--
-- Columns the device does not own (is_deleted/dirty/lamport/device_id) exist
-- here with defaults: the push never sends them, so they take the default, and
-- the client's pull column list ignores them.

-- ========== PICKUP EVENT (append-only: one row per goods pickup) ==========
create table if not exists sale_pickups (
  id text primary key,
  store_id text not null,
  sale_id text not null,
  sale_item_id text not null,
  quantity double precision not null default 0,
  picked_up_by text,
  device_id text,
  lamport_clock bigint not null default 0,
  is_deleted boolean not null default false,
  dirty integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_sale_pickups_store_created on sale_pickups(store_id, created_at);

-- ========== SHIFT (clock-in/clock-out + till opening) ==========
create table if not exists shifts (
  id text primary key,
  store_id text not null,
  cashier_id text not null,
  manager_id text,
  opening_balance double precision default 0,
  opening_stated double precision,
  opening_confirmed_by text,
  status text,
  start_time text,
  end_time text,
  actual_cash double precision,
  cashier_confirmed integer default 0,
  manager_confirmed integer default 0,
  supervisor_confirmed integer default 0,
  auto_closed integer default 0,
  device_id text,
  lamport_clock bigint not null default 0,
  is_deleted boolean not null default false,
  dirty integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_shifts_store_start on shifts(store_id, start_time);

-- ========== DAILY REPORT (the till's day: submitted/closed/reviewed) ==========
-- report_date stays text: it is a day key, not an instant. The clock columns
-- are text too — nothing filters or sorts on them server-side, and text keeps
-- a stray device-local format from rejecting the whole row.
create table if not exists daily_reports (
  id text primary key,
  store_id text not null,
  report_date text not null,
  role text not null,
  user_id text not null,
  shift_id text default null,
  status text default 'pending',
  standby_carry double precision default 0,
  opening_balance double precision default 0,
  expected_cash double precision default 0,
  actual_cash double precision default null,
  cash_sales double precision default 0,
  moncash_sales double precision default 0,
  natcash_sales double precision default 0,
  credit_sales double precision default 0,
  credit_collected_cash double precision default 0,
  credit_collected_moncash double precision default 0,
  credit_collected_natcash double precision default 0,
  withdrawals_total double precision default 0,
  inventory_total double precision default 0,
  deficit double precision default 0,
  submitted_at text,
  closed_at text,
  reviewed_by text,
  reviewed_at text,
  device_id text,
  lamport_clock bigint not null default 0,
  is_deleted boolean not null default false,
  dirty integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_daily_reports_store_date on daily_reports(store_id, report_date);

-- ========== SUSPENDED TAB (Vant an Atann) + its frozen lines ==========
create table if not exists suspended_sales (
  id text primary key,
  store_id text not null,
  label text not null,
  customer_id text,
  cashier_id text,
  cashier_name text,
  seller_role text,
  status text default 'open',
  total double precision default 0,
  completed_sale_id text,
  device_id text,
  lamport_clock bigint not null default 0,
  is_deleted boolean not null default false,
  dirty integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_suspended_sales_store_status on suspended_sales(store_id, status);

create table if not exists suspended_sale_items (
  id text primary key,
  suspended_sale_id text not null,
  store_id text not null,
  product_id text not null,
  product_name text not null,
  unit_id text,
  unit_name text,
  factor double precision default 1,
  variant text,
  quantity double precision,
  base_price double precision default 0,
  unit_price double precision,
  line_total double precision,
  bundle_applied integer default 0,
  device_id text,
  lamport_clock bigint not null default 0,
  is_deleted boolean not null default false,
  dirty integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_suspended_sale_items_tab on suspended_sale_items(suspended_sale_id);

-- ========== STANDBY HAND (cash handed to the manager after report lock) ==========
create table if not exists standby_hands (
  id text primary key,
  store_id text not null,
  cashier_id text not null,
  manager_id text,
  report_id text,
  carried_into_report_id text,
  sale_count integer default 0,
  amount double precision default 0,
  handed_at text,
  cashier_confirmed integer default 0,
  confirmed_at text,
  carried_at text,
  device_id text,
  lamport_clock bigint not null default 0,
  is_deleted boolean not null default false,
  dirty integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_standby_hands_store_created on standby_hands(store_id, created_at);

-- ========== NOTIFICATION (no store column: user-scoped, syncs unscoped) ==========
create table if not exists notifications (
  id text primary key,
  user_id text not null,
  type text,
  reference_id text,
  message text,
  status text default 'pending',
  device_id text,
  lamport_clock bigint not null default 0,
  is_deleted boolean not null default false,
  dirty integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_notifications_user_created on notifications(user_id, created_at);

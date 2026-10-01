-- 012 ASSISTED ORDERING (open orders shared by table service + retail floor).
--
-- One open-order object per identifier (table number / customer name) that
-- lives across many rounds: lines are PER ROUND — never merged live, only
-- collapsed at billing (the app's collapseForBilling). Mirrors the mobile
-- SQLite model: TEXT ids generated on the device, no FKs, soft delete, and
-- lamport_clock + updated_at for LWW merge (same convention as 004).
--
-- Line status travels in the record: waiting -> progress -> delivered,
-- plus 'cancelled' (creator cancel / manager override, never billed).
-- Change requests are their own table because a request against a locked
-- line only applies after the other side actively accepts it.

-- ========== OPEN ORDERS (Kòmand / Tab) ==========
create table if not exists open_orders (
  id text primary key,
  store_id text not null,
  mode text not null default 'retail',
  code_kind text not null default 'name',
  table_no text,
  customer_name text,
  customer_phone text,
  status text not null default 'open',
  created_by text,
  created_by_name text,
  device_id text,
  delivered_total numeric(16,4) not null default 0,
  line_count integer not null default 0,
  note text,
  locked_at timestamptz,
  closed_sale_id text,
  lamport_clock integer not null default 0,
  is_deleted boolean not null default false,
  dirty integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_open_orders_store_status on open_orders(store_id, status, created_at);
create trigger trg_open_orders_updated before update on open_orders for each row execute function set_updated_at();

-- ========== ORDER LINES (one row per item per round) ==========
create table if not exists open_order_lines (
  id text primary key,
  order_id text not null,
  store_id text not null,
  round_no integer not null default 1,
  product_id text,
  name text,
  unit_id text,
  unit_name text,
  factor numeric(16,6) not null default 1,
  variant text,
  qty numeric(16,4) not null default 0,
  unit_price numeric(16,4) not null default 0,
  line_total numeric(16,4) not null default 0,
  status text not null default 'waiting',
  attention integer not null default 0,
  attention_reason text,
  cancel_reason text,
  cancelled_by text,
  cancelled_at timestamptz,
  "override" integer not null default 0,
  created_by text,
  created_by_name text,
  started_by text,
  started_at timestamptz,
  delivered_by text,
  delivered_at timestamptz,
  revision integer not null default 0,
  lamport_clock integer not null default 0,
  is_deleted boolean not null default false,
  dirty integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_open_order_lines_order on open_order_lines(order_id, status);
create trigger trg_open_order_lines_updated before update on open_order_lines for each row execute function set_updated_at();

-- ========== CHANGE REQUESTS (against a locked line) ==========
create table if not exists order_change_requests (
  id text primary key,
  order_id text not null,
  line_id text not null,
  store_id text,
  kind text not null,
  payload text,
  reason text,
  requested_by text,
  requested_by_name text,
  requested_by_role text,
  status text not null default 'pending',
  decided_by text,
  decided_by_name text,
  decided_at timestamptz,
  lamport_clock integer not null default 0,
  is_deleted boolean not null default false,
  dirty integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_order_change_requests_status on order_change_requests(status, order_id);
create trigger trg_order_change_requests_updated before update on order_change_requests for each row execute function set_updated_at();

-- ========== AUDIT TRAIL (append-only) ==========
-- Every line action lands here with the actor id/role/rank plus the reason
-- when one is required (manager override). No update trigger: rows are never
-- rewritten, only inserted.
create table if not exists open_order_events (
  id text primary key,
  order_id text not null,
  store_id text,
  line_id text,
  action text not null,
  actor_id text,
  actor_name text,
  actor_role text,
  actor_rank integer,
  reason text,
  snapshot text,
  lamport_clock integer not null default 0,
  dirty integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_open_order_events_order on open_order_events(order_id, created_at);

-- ==================================================================
-- 001 Kourro Admin Portal — schema
--
-- Standalone admin portal tables, prefixed `adm_` so they can never
-- collide with the customer-facing tables (profiles, organizations,
-- subscriptions, plans ...). The portal owns its own tiers,
-- subscriptions, seats, invoices, activity log and notifications.
--
-- Row Level Security is ENABLED with no policies on every table:
-- the customer portal (anon/authenticated via PostgREST) therefore
-- has zero access to admin data. The portal's API server connects as
-- the table owner (DATABASE_URL), which bypasses RLS.
-- ==================================================================

create extension if not exists pgcrypto;

create or replace function set_updated_at() returns trigger as $$
begin new.updated_at = now(); return new; end; $$ language plpgsql;

-- ------------------------------------------------------------------
-- Platform staff — three roles.
--   super_admin : everything, plus the ONLY role that can create or
--                 change admin accounts (and platform tiers).
--   sales       : registers prospects, records payment, books setup.
--   technician  : completes on-site/remote setup, creates owner
--                 account, configures business type, starts billing.
-- ------------------------------------------------------------------
create table if not exists admin_users (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique,                 -- auth.users.id (Supabase Auth)
  email text not null unique,
  full_name text not null,
  role text not null check (role in ('super_admin','sales','technician')),
  status text not null default 'active' check (status in ('active','disabled')),
  created_by uuid references admin_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_admin_users_role on admin_users(role, status);
create trigger trg_admin_users_updated before update on admin_users
  for each row execute function set_updated_at();
alter table admin_users enable row level security;

-- ------------------------------------------------------------------
-- Subscription tiers — a real table, never hardcoded, so tiers can
-- grow limits + feature flags later (stores allowed, feature access).
-- Seeded below with editable starter rows; onboarding stays loose
-- (no hard enforcement of limits at signup time yet).
-- ------------------------------------------------------------------
create table if not exists adm_tiers (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  description text,
  price_cents integer not null default 0 check (price_cents >= 0),
  currency text not null default 'HTG',
  interval text not null default 'monthly' check (interval in ('monthly','yearly')),
  base_seats integer not null default 1 check (base_seats >= 0),   -- employee accounts included
  seat_price_cents integer not null default 0 check (seat_price_cents >= 0), -- per extra seat per interval
  max_stores integer,                                              -- null = unlimited
  features jsonb not null default '{}',                            -- loose feature-access map
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_adm_tiers_updated before update on adm_tiers
  for each row execute function set_updated_at();
alter table adm_tiers enable row level security;

-- ------------------------------------------------------------------
-- Business customers — the central pipeline record.
--   prospect        : sales registered the business
--   paid            : payment collected (sales marks paid)
--   setup_scheduled : setup appointment booked
--   setup_complete  : technician finished setup → billing clock starts
--   cancelled       : dead lead
-- ------------------------------------------------------------------
create table if not exists adm_businesses (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  contact_name text,
  contact_email text,
  contact_phone text,
  address text,
  business_type text,                            -- configured by the technician at setup
  tier_id uuid references adm_tiers(id) on delete set null,
  pipeline_status text not null default 'prospect'
    check (pipeline_status in ('prospect','paid','setup_scheduled','setup_complete','cancelled')),
  setup_appointment_at timestamptz,
  setup_completed_at timestamptz,                -- THE moment subscription billing starts
  owner_user_id uuid,                            -- auth.users.id created by the technician
  owner_email text,
  organization_id uuid,                          -- customer-portal organizations.id (informational)
  notes text,
  registered_by uuid references admin_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_adm_businesses_pipeline on adm_businesses(pipeline_status, created_at desc);
create index if not exists idx_adm_businesses_name on adm_businesses(lower(name));
create trigger trg_adm_businesses_updated before update on adm_businesses
  for each row execute function set_updated_at();
alter table adm_businesses enable row level security;

-- ------------------------------------------------------------------
-- Subscriptions — one per business. Prices/seat counts are snapshotted
-- at subscribe time so later tier edits never rewrite history.
--   started_at / current_period_start == setup completion moment,
--   NEVER the payment date.
--   extra_seats = paid seats beyond tier.base_seats.
-- ------------------------------------------------------------------
create table if not exists adm_subscriptions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null unique references adm_businesses(id) on delete cascade,
  tier_id uuid not null references adm_tiers(id),
  status text not null default 'active' check (status in ('active','expired','cancelled')),
  started_at timestamptz not null,
  current_period_start timestamptz not null,
  renews_at timestamptz not null,
  interval text not null default 'monthly' check (interval in ('monthly','yearly')),
  currency text not null default 'HTG',
  tier_price_cents integer not null default 0,
  seat_price_cents integer not null default 0,
  base_seats integer not null default 1,
  extra_seats integer not null default 0 check (extra_seats >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_adm_subscriptions_status on adm_subscriptions(status, renews_at);
create trigger trg_adm_subscriptions_updated before update on adm_subscriptions
  for each row execute function set_updated_at();
alter table adm_subscriptions enable row level security;

-- ------------------------------------------------------------------
-- Invoices (charges) + payments + applications → real balance.
--   balance = open invoices − unapplied payments  (positive = owes us)
-- ------------------------------------------------------------------
create sequence if not exists adm_invoice_seq start 1;

create table if not exists adm_invoices (
  id uuid primary key default gen_random_uuid(),
  number text not null unique default ('INV-' || lpad(nextval('adm_invoice_seq')::text, 6, '0')),
  business_id uuid not null references adm_businesses(id) on delete cascade,
  subscription_id uuid references adm_subscriptions(id) on delete set null,
  kind text not null check (kind in ('initial','renewal','seat_proration','manual','tier_upgrade')),
  description text not null,
  amount_cents integer not null check (amount_cents >= 0),
  status text not null default 'open' check (status in ('open','paid','void')),
  period_start timestamptz,
  period_end timestamptz,
  due_at timestamptz,
  created_by uuid references admin_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_adm_invoices_business on adm_invoices(business_id, status, created_at desc);
create index if not exists idx_adm_invoices_open on adm_invoices(status, due_at) where status = 'open';
create trigger trg_adm_invoices_updated before update on adm_invoices
  for each row execute function set_updated_at();
alter table adm_invoices enable row level security;

create table if not exists adm_payments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references adm_businesses(id) on delete cascade,
  amount_cents integer not null check (amount_cents > 0),
  currency text not null default 'HTG',
  method text not null default 'other'
    check (method in ('cash','card','transfer','mobile_money','other')),
  reference text,
  notes text,
  received_at timestamptz not null default now(),
  recorded_by uuid references admin_users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists idx_adm_payments_business on adm_payments(business_id, received_at desc);
alter table adm_payments enable row level security;

-- A single payment can be spread across several invoices (FIFO apply).
create table if not exists adm_payment_applications (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references adm_payments(id) on delete cascade,
  invoice_id uuid not null references adm_invoices(id) on delete cascade,
  amount_cents integer not null check (amount_cents > 0),
  created_at timestamptz not null default now(),
  unique (payment_id, invoice_id)
);
create index if not exists idx_adm_applications_invoice on adm_payment_applications(invoice_id);
alter table adm_payment_applications enable row level security;

-- ------------------------------------------------------------------
-- Activity log — every significant account action, append-only.
-- actor_type: 'admin' (staff), 'owner' (customer self-service), 'system'.
-- ------------------------------------------------------------------
create table if not exists adm_activity_log (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references adm_businesses(id) on delete set null,
  admin_id uuid references admin_users(id) on delete set null,
  actor_type text not null check (actor_type in ('admin','owner','system')),
  actor_label text not null,
  action text not null,
  summary text not null,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists idx_adm_activity_created on adm_activity_log(created_at desc);
create index if not exists idx_adm_activity_business on adm_activity_log(business_id, created_at desc);
create index if not exists idx_adm_activity_action on adm_activity_log(action, created_at desc);
alter table adm_activity_log enable row level security;

-- ------------------------------------------------------------------
-- Notifications — fanned out to every active admin at write time so
-- each teammate has their own read state. Self-service seat additions
-- (no approval gate) always land here for team follow-up.
-- ------------------------------------------------------------------
create table if not exists adm_notifications (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid not null references admin_users(id) on delete cascade,
  type text not null,
  title text not null,
  body text not null,
  business_id uuid references adm_businesses(id) on delete set null,
  link text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists idx_adm_notifications_admin on adm_notifications(admin_id, read_at, created_at desc);
alter table adm_notifications enable row level security;

-- ------------------------------------------------------------------
-- Migration ledger for this portal's own runner.
-- ------------------------------------------------------------------
create table if not exists adm_schema_migrations (
  name text primary key,
  applied_at timestamptz not null default now()
);

-- ------------------------------------------------------------------
-- Starter tiers — editable rows, NOT hardcoded behaviour.
-- Prices are placeholders in HTG minor units (adjust in the UI).
-- ------------------------------------------------------------------
insert into adm_tiers (code, name, description, price_cents, currency, interval, base_seats, seat_price_cents, max_stores, features, sort_order)
values
  ('standard', 'Standard',
   'Core POS, one location, team accounts included.',
   150000, 'HTG', 'monthly', 3, 25000, 3,
   '{"advanced_reports": false, "multi_store": false, "local_network": false}', 1),
  ('growth', 'Growth',
   'Everything in Standard plus multi-store and advanced reporting.',
   300000, 'HTG', 'monthly', 6, 25000, 10,
   '{"advanced_reports": true, "multi_store": true, "local_network": true}', 2)
on conflict (code) do nothing;

-- 013 PROMOTIONS: proformat / discount / coupon + redemption log + audit.
--
-- Mirrors the mobile SQLite model (012 convention): TEXT ids generated on the
-- device, no FKs, soft delete, lamport_clock + dirty + updated_at for LWW.
-- No changes to existing sales columns beyond the nullable proformat_id link.
--
-- Profit math lives client-side at issuance/redemption; these rows carry the
-- frozen inputs (percentage snapshot, flat goud, min/cap) and the outcomes.

-- ========== PROFORMAT (immutable price-check / preparation record) ==========
create table if not exists proformats (
  id text primary key,
  store_id text not null,
  receipt_number text not null,
  customer_id text not null,
  items text not null,              -- JSON snapshot: price + cost basis per line
  subtotal numeric(12,2) not null default 0,
  total numeric(12,2) not null default 0,
  created_by text,
  created_by_name text,
  created_by_role text,
  device_id text,
  lamport_clock integer not null default 0,
  is_deleted boolean not null default false,
  dirty integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists idx_proformats_receipt on proformats(receipt_number);
create index if not exists idx_proformats_store_created on proformats(store_id, created_at);
create index if not exists idx_proformats_customer on proformats(customer_id);
create trigger trg_proformats_updated before update on proformats for each row execute function set_updated_at();

-- ========== DISCOUNT (the bare reusable rate) ==========
create table if not exists discounts (
  id text primary key,
  store_id text not null,
  percentage numeric(8,3) not null, -- uncapped, may exceed 100 (deep clearance)
  created_by text,
  created_by_name text,
  created_by_role text,
  device_id text,
  lamport_clock integer not null default 0,
  is_deleted boolean not null default false,
  dirty integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_discounts_store_created on discounts(store_id, created_at);
create trigger trg_discounts_updated before update on discounts for each row execute function set_updated_at();

-- ========== COUPON (single-use activation layer) ==========
-- proformat_id is optional: issued from a proformat (flat goud frozen at
-- issuance) OR directly to a customer (amount computed at redemption).
-- min JSON: {"products":[{"product_id","name","qty"}],"min_amount","min_items"}
-- cap: hard ceiling on the final calculated discount.
create table if not exists coupons (
  id text primary key,
  store_id text not null,
  code text not null,               -- unique system-wide
  discount_id text not null,
  discount_percentage numeric(8,3) not null,
  proformat_id text,
  customer_id text not null,
  type text not null default 'unconditional' check (type in ('unconditional','conditional')),
  min text,
  cap numeric(12,2),
  expires_at timestamptz,
  status text not null default 'unused' check (status in ('unused','redeemed','expired')),
  flat_amount_goud integer,
  message text,
  created_by text,
  created_by_name text,
  created_by_role text,
  device_id text,
  lamport_clock integer not null default 0,
  is_deleted boolean not null default false,
  dirty integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists idx_coupons_code on coupons(code);
-- One discount attaches to a given proformat only once (NULLs are distinct,
-- so direct-issue coupons with no proformat are unlimited).
create unique index if not exists idx_coupons_performat_discount on coupons(store_id, proformat_id, discount_id);
create index if not exists idx_coupons_store_status on coupons(store_id, status, created_at);
create index if not exists idx_coupons_customer on coupons(customer_id);
create trigger trg_coupons_updated before update on coupons for each row execute function set_updated_at();

-- ========== REDEMPTION LOG (append-only, schema groundwork) ==========
-- One row per redemption: WHO redeemed and WHICH sale it applied to. The
-- authoritative sale<->coupon linkage is 1:N by design so broadcast-style
-- multi-person coupons need no schema rework later. Deferred: broadcast
-- creation, redemption limits, multi-person distribution.
create table if not exists coupon_redemptions (
  id text primary key,
  store_id text not null,
  coupon_id text not null,
  sale_id text,
  sale_number text,
  redeemed_by text,
  redeemed_by_name text,
  redeemed_by_role text,
  amount_applied numeric(12,2) not null default 0,
  lamport_clock integer not null default 0,
  is_deleted boolean not null default false,
  dirty integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_coupon_redemptions_coupon on coupon_redemptions(coupon_id, created_at);
create index if not exists idx_coupon_redemptions_sale on coupon_redemptions(sale_id);
create trigger trg_coupon_redemptions_updated before update on coupon_redemptions for each row execute function set_updated_at();

-- ========== PROMO AUDIT (append-only) ==========
-- discount creation, coupon issuance, coupon redemption + the sale it applied
-- to, proformat creation, expiry flips — every action, no matter how minor.
create table if not exists promo_audit (
  id text primary key,
  store_id text,
  action text not null,
  entity_type text,
  entity_id text,
  proformat_id text,
  discount_id text,
  coupon_id text,
  sale_id text,
  actor_id text,
  actor_name text,
  actor_role text,
  snapshot text,                    -- JSON detail of the action
  lamport_clock integer not null default 0,
  is_deleted boolean not null default false,
  dirty integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_promo_audit_store_created on promo_audit(store_id, created_at);
create index if not exists idx_promo_audit_entity on promo_audit(entity_type, entity_id);
create trigger trg_promo_audit_updated before update on promo_audit for each row execute function set_updated_at();

-- ========== EXISTING TABLE DELTAS ==========
-- Sale -> proformat reference (nullable): the sale stores where it came from.
alter table sales add column if not exists proformat_id text;
-- Phone-resolution auto-creations start as prospects; staff confirms later.
alter table customers add column if not exists is_prospect boolean not null default false;
create index if not exists idx_customers_is_prospect on customers(store_id) where is_prospect = true;

-- Inventory batch creation wizard (v3): session identity, item-level
-- supplier costs, and bundles with their own effective-dated price history.

-- ========== SESSION IDENTITY ==========
-- One wizard run can write several batches (multi-supplier Split). Transport
-- is asked once at the end of the run and patched across every batch that
-- carries the same session_ref.
alter table batches add column if not exists session_ref text;
create index if not exists idx_batches_session_ref on batches(session_ref);

-- ========== SUPPLIER COSTS re-keyed unit → item ==========
-- product_supplier_costs was written against legacy pre-cutover unit ids, but
-- batch lines carry item_id. item_id is backfilled from product_units on the
-- client; unit_id is kept as-is so the existing unique key and every existing
-- writer keep working. Readers key on item_id and tolerate a duplicate by
-- keeping the newest last_updated (see compareCost.ts).
alter table product_supplier_costs add column if not exists item_id text;
create index if not exists idx_psc_item on product_supplier_costs(item_id);

-- ========== BUNDLES + their own price history ==========
-- Splits the old product_bundles (min_quantity + a single bundle_price) into
-- a bundle record and effective-dated prices, mirroring variants/variant_prices.
-- active lets a bundle be switched off without destroying its history.
create table if not exists bundles (
  id text primary key,
  variant_id text not null,
  min_quantity numeric(16,4) not null default 1,
  active boolean not null default true,
  device_id text,
  lamport_clock integer not null default 0,
  is_deleted boolean not null default false,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_bundles_variant on bundles(variant_id);
create trigger trg_bundles_updated before update on bundles for each row execute function set_updated_at();

create table if not exists bundle_prices (
  id text primary key,
  bundle_id text not null,
  price numeric(16,2) not null check (price >= 0),
  date date not null,
  device_id text,
  lamport_clock integer not null default 0,
  is_deleted boolean not null default false,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_bundle_prices_bundle on bundle_prices(bundle_id);
create trigger trg_bundle_prices_updated before update on bundle_prices for each row execute function set_updated_at();

-- Existing rows: every product_bundles row becomes one bundle + one price row.
insert into bundles (id, variant_id, min_quantity, active, created_at, updated_at)
select pb.id, pb.variant_id, pb.min_quantity, true, coalesce(pb.created_at, now()), now()
from product_bundles pb
where pb.variant_id is not null
  and not exists (select 1 from bundles b where b.id = pb.id)
on conflict (id) do nothing;

insert into bundle_prices (id, bundle_id, price, date, created_at, updated_at)
select 'bpri-' || pb.id, pb.id, pb.bundle_price,
       coalesce(pb.created_at::date, now()::date), coalesce(pb.created_at, now()), now()
from product_bundles pb
where pb.variant_id is not null
  and pb.bundle_price is not null
  and not exists (select 1 from bundle_prices bp where bp.bundle_id = pb.id)
on conflict (id) do nothing;

-- Backfill item_id on rows written before this migration.
update product_supplier_costs psc
set item_id = i.id
from product_units pu
join items i on i.product_id = pu.product_id and i.name = pu.unit_name
where psc.item_id is null
  and psc.unit_id = pu.id
  and coalesce(psc.is_deleted, false) = false;

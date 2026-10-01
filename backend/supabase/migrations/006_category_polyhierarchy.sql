-- 006 Category polyhierarchy + product link tables.
-- Businesses differ: a category can have MULTIPLE parents (Beer is both a
-- Drink and Alcohol), so hierarchy is a DAG in category_links, not parent_id.
-- products/catalog stay global; categories stay store-scoped (legacy), links
-- follow the categories they connect. TEXT ids (mobile generates offline).

-- ========== CATEGORY_LINKS (DAG edges) ==========
create table if not exists category_links (
  id text primary key,
  child_id text not null,
  parent_id text not null,
  device_id text,
  lamport_clock integer not null default 0,
  is_deleted boolean not null default false,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (child_id, parent_id),
  check (child_id != parent_id)
);
create index if not exists idx_category_links_child on category_links(child_id);
create index if not exists idx_category_links_parent on category_links(parent_id);
create trigger trg_category_links_updated before update on category_links for each row execute function set_updated_at();

-- ========== PRODUCT_CATEGORIES (multi-assign join) ==========
-- Mobile/desktop already use this join locally; the server never had it.
create table if not exists product_categories (
  id text primary key,
  product_id text not null,
  category_id text not null,
  device_id text,
  lamport_clock integer not null default 0,
  is_deleted boolean not null default false,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (product_id, category_id)
);
create index if not exists idx_product_categories_product on product_categories(product_id);
create index if not exists idx_product_categories_category on product_categories(category_id);
create trigger trg_product_categories_updated before update on product_categories for each row execute function set_updated_at();

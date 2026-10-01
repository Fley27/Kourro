-- 010 Supplier structured address + payment methods + repeatable bank accounts.
-- Follows 004/005 conventions: TEXT ids (mobile generates them offline),
-- lamport_clock LWW, soft delete, set_updated_at trigger.

-- ========== SUPPLIERS: structured address + multi-select payments ==========
-- country: ISO code (HT preselected in the form).
-- department: Haitian dept code (OU/AR/...) or free text when "Other".
-- city + address: address stays a single line (no line 2 / postal code).
-- payment_methods: JSON array of ids — ["cash","bank"], extendable later.
alter table suppliers add column if not exists country text;
alter table suppliers add column if not exists department text;
alter table suppliers add column if not exists city text;
alter table suppliers add column if not exists payment_methods text;

-- ========== SUPPLIER BANK ACCOUNTS (repeatable sub-records) ==========
-- Shown only when the "bank" payment method is checked. Many Haitian
-- suppliers hold both a gourde and a dollar account simultaneously, so rows
-- are unlimited. currency: 'HTG' (gourde) | 'USD' (dollar).
-- Global like suppliers: store_id legacy/nullable, never store-scoped.
create table if not exists supplier_bank_accounts (
  id text primary key,
  store_id text,
  supplier_id text not null,
  bank_name text not null,
  currency text not null,
  account_number text,
  sort_order integer not null default 0,
  device_id text,
  lamport_clock integer not null default 0,
  is_deleted boolean not null default false,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_supplier_bank_accounts_supplier
  on supplier_bank_accounts(supplier_id);
create trigger trg_supplier_bank_accounts_updated before update on supplier_bank_accounts for each row execute function set_updated_at();

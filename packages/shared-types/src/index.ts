// @retail/shared-types — used by backend, middleware, mobile-app, web-app
// Both TS and JS consumers can import from dist

// --- Base sync fields every replicated row carries ---
export interface SyncMeta {
  id: string; // UUIDv7
  store_id: string;
  device_id: string | null;
  created_at: string; // ISO
  updated_at: string; // ISO
  lamport_clock: number;
  is_deleted: boolean;
  version: number;
}

// --- Roles ---
export type UserRole = 'owner' | 'admin' | 'manager' | 'cashier';
export type Language = 'ht' | 'fr' | 'en'; // ht = Kreyòl

// A store IS a location of a business (organization). Multiple stores share
// the same products catalog; each has its own inventory and staff.
export interface Store extends SyncMeta {
  name: string;
  address: string | null;
  phone: string | null;
  owner_id: string | null;
  currency: string; // HTG default
  is_active: boolean;
  organization_id: string | null;
}

// --- Tenancy: business owner owns an organization with up to N locations ---
export interface Organization {
  id: string;
  owner_id: string;
  name: string;
  currency: string;
  created_at: string;
  updated_at: string;
}

// --- Subscription plans ---
export type PlanCode = 'basic' | 'pro' | 'exclusive';
export type SubscriptionStatus = 'trial' | 'active' | 'paused' | 'cancelled';

export interface Plan {
  code: PlanCode;
  name: string;
  max_locations: number;
  max_accounts: number; // total staff seats (admin+manager+cashier), excluding owner
  role_limits?: Partial<Record<UserRole, number>>; // per-role caps (basic)
  desktop_app: boolean;
  pro_email: boolean;
  website_discount_pct: number;
  local_network: boolean;
}

export const PLANS: Record<PlanCode, Plan> = {
  basic: {
    code: 'basic',
    name: 'Basic',
    max_locations: 1,
    max_accounts: 3,
    role_limits: { admin: 1, manager: 1, cashier: 1 },
    desktop_app: false,
    pro_email: false,
    website_discount_pct: 0,
    local_network: false,
  },
  pro: {
    code: 'pro',
    name: 'Pro',
    max_locations: 3,
    max_accounts: 8,
    desktop_app: false,
    pro_email: false,
    website_discount_pct: 0,
    local_network: false,
  },
  exclusive: {
    code: 'exclusive',
    name: 'Exclusive',
    max_locations: 3,
    max_accounts: 8,
    desktop_app: true,
    pro_email: true,
    website_discount_pct: 30,
    local_network: true,
  },
};

export interface Subscription {
  id: string;
  organization_id: string;
  plan_code: PlanCode;
  status: SubscriptionStatus;
  trial_ends_at: string | null;
  started_at: string;
  renews_at: string | null;
  created_at: string;
  updated_at: string;
}

// --- Subscription enforcement (migration 029) ---
// ONE writability rule shared by mobile (local read-only UI), middleware (push
// pre-check) and the Postgres trigger (authoritative). Reads are always
// allowed; only writes are gated. The SQL mirror lives in 029 — a change here
// must land there in the same release.

/** Minimal shape needed to decide writability (the latest subscription row). */
export interface SubscriptionLike {
  status: string | null;
  trial_ends_at?: string | null;
  renews_at?: string | null;
}

/**
 * True when the org may WRITE.
 *  - no subscription row at all → false (unknown/legacy → read-only)
 *  - 'trial'  → writable while trial_ends_at is null or in the future
 *  - 'active' → writable while renews_at is null or in the future
 *  - 'paused' / 'cancelled' → false
 */
export function isSubscriptionWritable(
  sub: SubscriptionLike | null | undefined,
  now: Date | number = Date.now()
): boolean {
  if (!sub) return false;
  const ms = typeof now === "number" ? now : now.getTime();
  const future = (v?: string | null): boolean => {
    if (v == null || v === "") return true;
    const t = Date.parse(v);
    return isNaN(t) ? false : t > ms;
  };
  switch (sub.status) {
    case "trial": return future(sub.trial_ends_at);
    case "active": return future(sub.renews_at);
    default: return false;
  }
}

/** Server status a blocked push change comes back with. */
export const SUBSCRIPTION_EXPIRED_STATUS = "error:subscription_expired";

/** Tables that never gate on subscription status (infra / close-out bookkeeping). */
export const SUBSCRIPTION_ALWAYS_WRITABLE: ReadonlySet<string> = new Set([
  "notifications",
  "daily_reports",
]);

/** Status values that mean "this record is being closed/retired", not advanced. */
export const CLOSE_OUT_STATUSES: ReadonlySet<string> = new Set([
  "closed", "cancelled", "canceled", "denied", "completed", "rejected", "done",
]);

/**
 * Tables where an UPDATE moving a row INTO a terminal status stays allowed
 * while the subscription is not writable — closing an open shift or cancelling
 * an existing order must never be blocked, or rows/windows stay stranded.
 */
export const CLOSE_OUT_TABLES: ReadonlySet<string> = new Set([
  "shifts",
  "open_orders",
  "open_order_lines",
  "order_change_requests",
  "open_order_events",
  "suspended_sales",
  "standby_hands",
  "orders",
  "proformats",
]);

/**
 * True when a pending write must be REFUSED because the subscription is not
 * writable. Close-out rule: only an UPDATE on a close-out table carrying a
 * terminal `status` passes; inserts, deletes and everything else is a new
 * business write.
 */
export function isSubscriptionBlockedWrite(
  table: string,
  operation: "create" | "update" | "delete",
  record: any
): boolean {
  if (SUBSCRIPTION_ALWAYS_WRITABLE.has(table)) return false;
  if (operation !== "update") return true;
  if (!CLOSE_OUT_TABLES.has(table)) return true;
  const status = (record as any)?.status;
  return !(typeof status === "string" && CLOSE_OUT_STATUSES.has(status));
}

export interface User extends SyncMeta {
  email: string;
  full_name: string;
  role: UserRole;
  language: Language;
  pin_code: string | null; // 4-digit for cashier quick login
  store_ids: string[]; // RLS helper, actual via store_members
}

export interface StoreMember {
  id: string;
  store_id: string;
  organization_id: string | null;
  user_id: string;
  role: UserRole;
  created_at: string;
}

export interface Category extends SyncMeta {
  name: string;
  name_ht: string | null;
  color: string | null;
}

export interface Product extends SyncMeta {
  sku: string | null;
  barcode: string | null;
  name: string;
  name_ht: string | null;
  category_id: string | null;
  item_type: 'goods' | 'service'; // services never decrement stock
  is_available: boolean; // 86-toggle: unavailable services hidden from POS
  unit: string; // 'pcs', 'kg', 'sack' etc
  cost_price: number; // last cost
  selling_price: number;
  stock_quantity: number;
  current_amount_available: number;
  low_stock_threshold: number;
  image_url: string | null;
}

export interface PriceHistory extends SyncMeta {
  product_id: string;
  old_cost: number | null;
  new_cost: number;
  old_price: number | null;
  new_price: number;
  reason: string | null;
  changed_by: string | null;
}

export interface Customer extends SyncMeta {
  name: string;
  phone: string | null;
  email?: string | null; // saved email for receipt-by-email (post-payment options)
  id_card_number: string | null; // Haitian NIF/CIN to distinguish same names, required for credit
  address: string | null;
  notes: string | null;
  credit_limit: number | null; // null = unlimited, number = hard limit
  credit_limit_source?: 'manual' | 'auto' | null; // who set limit first wins
  credit_limit_set_at?: string | null;
  total_debt: number; // denormalized
  is_high_risk?: boolean; // true if has any unpaid debt (from v_customer_risk)
  open_debt_count?: number;
}

export type SaleStatus = 'completed' | 'pending' | 'cancelled' | 'credit';
export type PaymentMethod = 'cash' | 'credit' | 'mobile_money' | 'mixed';

export interface Sale extends SyncMeta {
  sale_number: string; // human readable e.g. VTE-2026-0001
  customer_id: string | null;
  status: SaleStatus;
  payment_method: PaymentMethod;
  subtotal: number;
  discount: number;
  total: number;
  amount_paid: number;
  amount_due: number; // for credit
  notes: string | null;
  cashier_id: string | null;
  // Complimentary/promo: stock deducts normally, revenue is zero.
  // Whole-sale gratis = zero-total cash only (never credit).
  is_complimentary: boolean;
  complimentary_reason: string | null;
  approved_by: string | null; // manager+ who granted it
}

export interface SaleItem extends SyncMeta {
  sale_id: string;
  product_id: string;
  product_name: string; // snapshot at time of sale
  unit_id: string | null;
  variant: string | null; // legacy mirror of unit condition (transition)
  quantity: number; // quantity paid (source of truth)
  quantity_delivered?: number; // quantity taken so far (staging: partial pickup)
  quantity_remaining?: number; // computed: quantity - quantity_delivered
  unit_price: number;
  cost_price: number; // snapshot for profit calc
  line_total: number;
  is_complimentary: boolean; // gratis line: deducts stock, zero revenue
  approved_by: string | null;
}

// --- Partial pickup / delivery tracking (staging, additive only) ---
export interface SalePickup extends SyncMeta {
  sale_id: string;
  sale_item_id: string;
  quantity: number; // decimal-safe, must be > 0 and <= remaining
  picked_up_by: string | null;
}

export type CreditStatus = 'pending' | 'partial' | 'paid' | 'overdue';

export interface Credit extends SyncMeta {
  sale_id: string;
  customer_id: string;
  amount: number;
  amount_paid: number;
  balance: number;
  due_date: string | null;
  status: CreditStatus;
  debt_id?: string; // alias: each credit row IS a Debt ID (unique per transaction)
  will_be_late?: boolean; // customer flagged "I'll be late" to avoid penalty
  will_be_late_reason?: string | null;
}

export interface CreditPayment extends SyncMeta {
  credit_id: string; // = debt_id
  debt_id?: string; // alias
  amount: number;
  payment_method: PaymentMethod;
  received_by: string | null;
  receipt_number?: string | null; // e.g. REC-2026-0001, always issued
  notes: string | null;
}

export interface CashSession extends SyncMeta {
  store_id: string;
  cashier_id: string;
  opened_at: string;
  closed_at: string | null;
  opening_balance: number;
  closing_balance: number | null;
  expected_balance: number | null;
  discrepancy: number | null;
  status: 'open' | 'closed';
}

export interface StockMovement extends SyncMeta {
  product_id: string;
  type: 'sale' | 'purchase' | 'adjustment' | 'return' | 'transfer';
  quantity: number; // negative for outbound
  reason: string | null;
  reference_id: string | null; // sale_id etc
  created_by: string | null;
}

export interface StockBatch extends SyncMeta {
  reference: string | null;
  supplier: string | null; // legacy free text, kept for history
  supplier_id: string | null; // FK -> global suppliers (new receives)
  transport_cost: number;
  notes: string | null;
  total_items_cost: number;
  total_cost: number;
  received_at: string | null;
  status: string; // 'pending' | 'delivered'
  delivered_at: string | null;
  created_by: string | null;
}

export interface Supplier extends Omit<SyncMeta, "store_id"> {
  // Suppliers are GLOBAL (same business, all locations). store_id is legacy:
  // old rows carry one, new rows write null and reads stop scoping by store.
  store_id: string | null;
  name: string;
  phone: string | null;
  country: string | null; // ISO code, HT preselected in the form
  department: string | null; // Haitian dept code, or free text when "Other"
  city: string | null;
  address: string | null; // single line — no line 2 / postal code
  payment_methods: string | null; // JSON array of ids: cash/bank/remittance
  payment_terms: string | null;
  bank_info: string | null; // legacy free-text: owner-only, never overwritten
  notes: string | null;
}

// Repeatable supplier bank sub-records (shown when "bank" is checked).
// Global like suppliers; currency is 'HTG' (gourde) | 'USD' (dollar).
export interface SupplierBankAccount extends Omit<SyncMeta, "store_id"> {
  store_id: string | null;
  supplier_id: string;
  bank_name: string;
  currency: string;
  account_number: string | null;
  sort_order: number;
}

// --- Catalog x Supplier: units carry the variant dimensions ---
export interface ProductUnit {
  id: string;
  product_id: string;
  unit_name: string; // label: "box of 24", "single unit", "shot"
  condition: string | null; // "cold", "room temperature", null = none
  conversion_factor: number; // back to base unit; sub-unit shots deduct fractionally
  device_id: string | null;
  lamport_clock: number;
  is_deleted: boolean;
  version: number;
  created_at: string;
  updated_at: string;
}

// Global join: one row per (product, supplier, unit). Cost only — resell is
// one-per-unit and lives with selling prices. No store_id (business-wide).
export interface ProductSupplierCost {
  id: string;
  product_id: string;
  supplier_id: string;
  unit_id: string;
  cost: number;
  last_updated: string; // ISO
  device_id: string | null;
  lamport_clock: number;
  is_deleted: boolean;
  version: number;
  created_at: string;
  updated_at: string;
}

// --- Sync scope map ---------------------------------------------------------
// A tenant is a business (organizations). Inside a business:
//   store : sales/shifts/tabs, inventory, batches, price history, plus the
//           product/category rows each store owns
//   org   : suppliers, clients, their debts, and the business-wide catalog
//           core (items/variants/prices/bundles/units/costs/links) —
//           filtered by organization_id (or any of the org's stores)
//   user  : notifications — per user, not per store
//   self  : the caller's own profile row (id = auth uid)
// Anything not listed here is store-scoped. The middleware stamps the
// server-side column on push and filters on pull; clients can't override it.
export type TableScope =
  | { kind: "store"; column: "store_id" }
  | { kind: "org"; column: "organization_id"; stampStoreId?: boolean }
  | { kind: "org_wide"; column: "store_id" }
  | { kind: "user"; column: "user_id" }
  | { kind: "self"; column: "id" };

export const TABLE_SCOPES: Readonly<Record<string, TableScope>> = {
  // stampStoreId: the row keeps the writing store as provenance (NOT NULL in
  // the cloud schema) alongside its business-wide organization_id.
  customers: { kind: "org", column: "organization_id", stampStoreId: true },
  suppliers: { kind: "org", column: "organization_id", stampStoreId: true },
  supplier_bank_accounts: { kind: "org", column: "organization_id", stampStoreId: true },
  // Business-wide catalog core (migration 024 added organization_id).
  items: { kind: "org", column: "organization_id" },
  variants: { kind: "org", column: "organization_id" },
  variant_prices: { kind: "org", column: "organization_id" },
  bundles: { kind: "org", column: "organization_id" },
  bundle_prices: { kind: "org", column: "organization_id" },
  product_units: { kind: "org", column: "organization_id" },
  product_supplier_costs: { kind: "org", column: "organization_id" },
  product_suppliers: { kind: "org", column: "organization_id" },
  product_categories: { kind: "org", column: "organization_id" },
  category_links: { kind: "org", column: "organization_id" },
  // Debts are business-wide but still hang off a store row (who made the sale):
  // stamped like a store row, visible across every store of the business.
  credits: { kind: "org_wide", column: "store_id" },
  credit_payments: { kind: "org_wide", column: "store_id" },
  notifications: { kind: "user", column: "user_id" },
  profiles: { kind: "self", column: "id" },
  store_members: { kind: "store", column: "store_id" },
  // Payroll (028): org-wide across every store — the period cycle is shared,
  // salary and the locked payment ledger are business-wide facts, and deficit
  // rows keep the report's store as stamped provenance only.
  pay_periods: { kind: "org", column: "organization_id" },
  salary_history: { kind: "org", column: "organization_id", stampStoreId: true },
  salary_deficits: { kind: "org", column: "organization_id", stampStoreId: true },
  salary_payments: { kind: "org", column: "organization_id", stampStoreId: true },
};

export function scopeOf(table: string): TableScope {
  return TABLE_SCOPES[table] ?? { kind: "store", column: "store_id" };
}

// Org-scoped tables that ALSO carry a store_id column (legacy provenance).
// The pull adds a `store_id.in.(…)` OR-leg for these only — the catalog core
// (items/variants/prices/units/…) has no store_id, and referencing it makes
// PostgREST 42703 the per-table query, which fails the entire pull.
export const ORG_TABLES_WITH_STORE: ReadonlySet<string> = new Set([
  "customers",
  "suppliers",
  "supplier_bank_accounts",
]);

// Tables the sync endpoints accept. Same shape as the SQLite schema, so a
// rename here must land on the device in the same release.
export const SYNC_TABLES = [
  "products","product_stock","customers","sales","sale_items","credits","credit_payments","price_history","categories","cash_sessions","stock_movements","stock_batches","suppliers","supplier_bank_accounts","orders","employee_stores","product_units","product_supplier_costs","category_links","product_categories","items","product_suppliers","batches","variants","variant_prices","bundles","bundle_prices","open_orders","open_order_lines","order_change_requests","open_order_events","proformats","discounts","coupons","coupon_redemptions","promo_audit","sale_pickups","shifts","daily_reports","suspended_sales","suspended_sale_items","standby_hands","notifications","profiles","store_members","pay_periods","salary_history","salary_deficits","salary_payments",
] as const;

// --- Initial download / 90-day rolling window ---
// A fresh device (empty SQLite + successful login) pulls in phases instead of
// one unbounded epoch pull. The window only bounds what a catching-up device
// DOWNLOADS; local rows are never pruned by age — once on the device, data
// stays permanently. Incremental pulls (since the cursor) are always unwindowed.
export const WINDOW_DAYS = 90;
// A device whose last successful pull is older than this is "stale": it runs
// the open-items sweep in addition to the normal incremental pull.
export const STALE_AFTER_DAYS = 3;

// Operational reference data — always fully available, any age. These are
// not history: the POS cannot sell without products/batches, the credit desk
// cannot work without clients, the stockroom without suppliers.
export const REFERENCE_TABLES = [
  "products","product_stock","categories","product_categories","category_links",
  "items","variants","variant_prices","product_units","product_suppliers",
  "product_supplier_costs","bundles","bundle_prices",
  "suppliers","supplier_bank_accounts","customers",
  "batches","stock_batches",
  "profiles","employee_stores","store_members",
  "pay_periods","salary_history","salary_deficits","salary_payments",
] as const;

// Open / unfinished items — need action no matter how old, so a catching-up
// device always receives them regardless of the window. Values are the
// server-side predicates (translated by the middleware pull handler).
// Companions (parent sale for a credit, lines for an open order…) are pulled
// by the client via the `ids` param after the open rows arrive.
export const OPEN_ITEM_PREDICATES: Record<string, OpenPredicate[]> = {
  credits: [{ kind: "gt", column: "balance", value: 0 }],
  // Partial pickups: lines with undelivered quantity, any age (PostgREST
  // column-to-column compare). Their pickup history rides along windowed.
  sale_items: [{ kind: "lt_cols", column: "quantity_delivered", other: "quantity" }],
  suspended_sales: [{ kind: "eq", column: "status", value: "open" }],
  open_orders: [{ kind: "in", column: "status", values: ["open", "ready", "settling"] }],
  order_change_requests: [{ kind: "eq", column: "status", value: "pending" }],
  orders: [{ kind: "in", column: "status", values: ["requested", "approved", "ordered"] }],
  shifts: [{ kind: "eq", column: "status", value: "open" }],
  daily_reports: [{ kind: "in", column: "status", values: ["pending", "submitted"] }],
  notifications: [{ kind: "eq", column: "status", value: "pending" }],
  standby_hands: [{ kind: "is_null", column: "carried_at", value: true }],
};

export type OpenPredicate =
  | { kind: "eq"; column: string; value: string | number | boolean }
  | { kind: "gt"; column: string; value: number }
  | { kind: "in"; column: string; values: (string | number)[] }
  | { kind: "is_null"; column: string; value: boolean }
  | { kind: "lt_cols"; column: string; other: string };

export type OrderStatus = 'requested' | 'approved' | 'ordered' | 'received' | 'cancelled';

export interface Order extends SyncMeta {
  item_name: string;
  qty: number;
  unit: string | null;
  supplier_name: string | null;
  note: string | null;
  status: OrderStatus;
  requested_by: string | null;
  requested_by_name: string | null;
  approved_by: string | null;
}

export interface EmployeeStore {
  employee_id: string;
  store_id: string;
  created_at: string;
}

// --- Category polyhierarchy (DAG): multiple parents allowed ---
export interface CategoryLink {
  id: string;
  child_id: string;
  parent_id: string;
  device_id: string | null;
  lamport_clock: number;
  is_deleted: boolean;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface ProductCategory {
  id: string; // `${product_id}__${category_id}` when the writer has no ids
  product_id: string;
  category_id: string;
  device_id: string | null;
  lamport_clock: number;
  is_deleted: boolean;
  version: number;
  created_at: string;
  updated_at: string;
}
// --- Sync protocol ---
export type SyncOperation = 'create' | 'update' | 'delete';

export interface SyncChange<T = unknown> {
  table: string;
  operation: SyncOperation;
  record: T & SyncMeta;
}

export interface SyncPushPayload {
  device_id: string;
  store_id: string;
  changes: SyncChange[];
  last_synced_at: string | null;
}

export interface SyncPullResponse {
  changes: SyncChange[];
  server_time: string;
  has_more: boolean;
}

// --- API DTOs ---
export interface Paginated<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
}

export interface ProfitSummary {
  store_id: string;
  date_from: string;
  date_to: string;
  total_revenue: number;
  total_cost: number;
  gross_profit: number;
  margin_percent: number;
  sales_count: number;
  average_ticket: number;
}

export interface InflationPoint {
  product_id: string;
  product_name: string;
  date: string;
  cost_price: number;
  selling_price: number;
}

// --- i18n keys (Kreyòl first) ---
export const KREYOL = {
  appName: "Kourro",
  sale: "Vant",
  credit: "Kredi",
  debt: "Dèt",
  stock: "Stòk",
  profit: "Pwofi",
  pay: "Peye",
  total: "Total",
  customer: "Kliyan",
  addProduct: "Ajoute pwodwi",
  lowStock: "Stòk fèb",
  dailySales: "Vant jounen an",
} as const;

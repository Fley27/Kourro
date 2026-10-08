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

// Tables that sync WITHOUT store scoping (business-wide catalog data).
export const GLOBAL_TABLES: readonly string[] = [
  "suppliers",
  "supplier_bank_accounts",
  "product_units",
  "product_supplier_costs",
  "items",
  "product_suppliers",
  "batches",
  "variants",
  "variant_prices",
  "bundles",
  "bundle_prices",
  "product_categories",
  "category_links",
] as const;

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

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
  unit: string; // 'pcs', 'kg', 'sack' etc
  cost_price: number; // last cost
  selling_price: number;
  stock_quantity: number;
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
}

export interface SaleItem extends SyncMeta {
  sale_id: string;
  product_id: string;
  product_name: string; // snapshot at time of sale
  quantity: number;
  unit_price: number;
  cost_price: number; // snapshot for profit calc
  line_total: number;
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

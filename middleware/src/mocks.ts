export const MOCK_STORE_ID = "demo-store-id";

// Dev mock catalog — single source: packages/mock-catalog (committed JSON).
// Loaded from disk with graceful fallback so mock mode never crashes when
// files are absent. Regenerate with: npm run generate --workspace=@retail/mock-catalog
import { readFileSync } from "node:fs";

function loadCatalogJson(name: string): any[] {
  try {
    const url = new URL(`../../packages/mock-catalog/${name}`, import.meta.url);
    return JSON.parse(readFileSync(url, "utf8"));
  } catch {
    return [];
  }
}

const catalogProducts: any[] = loadCatalogJson("products.json");
const catalogCosts: any[] = loadCatalogJson("product_supplier_costs.json");
const catalogSuppliers: any[] = loadCatalogJson("suppliers.json");

function avgCost(productId: string): number {
  const rows = catalogCosts.filter((c) => c.product_id === productId);
  if (!rows.length) return 0;
  return Math.round(rows.reduce((s, c) => s + c.cost, 0) / rows.length);
}

export const mockProducts =
  catalogProducts.length > 0
    ? catalogProducts.map((p: any) => ({
        id: p.id,
        store_id: MOCK_STORE_ID,
        sku: p.sku,
        barcode: p.barcode,
        name: p.name,
        name_ht: p.name_ht,
        unit: p.units?.[0]?.label ?? "Unit",
        cost_price: avgCost(p.id),
        selling_price: p.units?.[0]?.sell ?? 0,
        stock_quantity: p.stock ?? 0,
        low_stock_threshold: p.low ?? 5,
        is_deleted: false,
        updated_at: new Date().toISOString(),
      }))
    : [];

export const mockSuppliers = catalogSuppliers.map((s: any) => ({
  ...s,
  store_id: null, // global (legacy field)
  is_deleted: false,
  updated_at: new Date().toISOString(),
}));

export const mockCustomers: any[] = [
  { id: "cust-1", store_id: MOCK_STORE_ID, name: "Jean Baptiste", phone: "+509 3810 0001", total_debt: 3500, credit_limit: 5000, is_deleted: false },
  { id: "cust-2", store_id: MOCK_STORE_ID, name: "Marie Claire", phone: "+509 3820 0002", total_debt: 0, credit_limit: 3000, is_deleted: false },
];

export const mockSales: any[] = [
  {
    id: "sale-1", store_id: MOCK_STORE_ID, sale_number: "VTE-0001", status: "completed", payment_method: "cash", subtotal: 6400, total: 6400, amount_paid: 6400, amount_due: 0, customer_id: null, created_at: new Date().toISOString(), is_deleted: false,
    sale_items: [
      { product_id: "p-rice-25kg", product_name: "Rice 25kg", quantity: 2, unit_price: 3200, cost_price: 2500, line_total: 6400 },
    ]
  },
  {
    id: "sale-2", store_id: MOCK_STORE_ID, sale_number: "VTE-0002", status: "credit", payment_method: "credit", subtotal: 1100, total: 1100, amount_paid: 0, amount_due: 1100, customer_id: "cust-1", created_at: new Date().toISOString(), is_deleted: false,
    sale_items: [
      { product_id: "p-oil-5l", product_name: "Cooking Oil 5L", quantity: 1, unit_price: 1100, cost_price: 800, line_total: 1100 },
    ]
  },
];

export const mockCreditPayments: any[] = [
  // example debt payment already received today
  { id: "pay-1", store_id: MOCK_STORE_ID, customer_id: "cust-1", amount: 1200, created_at: new Date().toISOString() },
];

export const mockPriceHistory = [
  { product_id: "p-rice-25kg", old_cost: 2500, new_cost: 2700, old_price: 3200, new_price: 3400, created_at: "2024-06-01T00:00:00Z" },
  { product_id: "p-rice-25kg", old_cost: 2700, new_cost: 3000, old_price: 3400, new_price: 3700, created_at: "2025-01-01T00:00:00Z" },
];

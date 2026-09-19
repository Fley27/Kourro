export const MOCK_STORE_ID = "demo-store-id";

export const mockProducts = [
  { id: "prod-1", store_id: MOCK_STORE_ID, sku: "RICE-25KG", barcode: "RICE-25KG", name: "Rice 25kg", name_ht: "Diri 25kg", unit: "sack", cost_price: 2500, selling_price: 3200, stock_quantity: 40, low_stock_threshold: 5, is_deleted: false, updated_at: new Date().toISOString() },
  { id: "prod-2", store_id: MOCK_STORE_ID, sku: "OIL-5L", barcode: "OIL-5L", name: "Cooking Oil 5L", name_ht: "Lwil 5L", unit: "pcs", cost_price: 800, selling_price: 1100, stock_quantity: 25, low_stock_threshold: 5, is_deleted: false, updated_at: new Date().toISOString() },
  { id: "prod-3", store_id: MOCK_STORE_ID, sku: "PREST-330", barcode: "PREST-330", name: "Prestige Beer", name_ht: "Prestige", unit: "pcs", cost_price: 75, selling_price: 100, stock_quantity: 3, low_stock_threshold: 20, is_deleted: false, updated_at: new Date().toISOString() },
  { id: "prod-4", store_id: MOCK_STORE_ID, sku: "SOAP-001", barcode: "SOAP-001", name: "Laundry Soap", name_ht: "Savon", unit: "pcs", cost_price: 30, selling_price: 50, stock_quantity: 200, low_stock_threshold: 30, is_deleted: false, updated_at: new Date().toISOString() },
  { id: "prod-5", store_id: MOCK_STORE_ID, sku: "FARIN-25KG", barcode: "FARIN-25KG", name: "Flour 25kg", name_ht: "Farin 25kg", unit: "sack", cost_price: 2200, selling_price: 2800, stock_quantity: 30, low_stock_threshold: 5, is_deleted: false, updated_at: new Date().toISOString() },
  { id: "prod-6", store_id: MOCK_STORE_ID, sku: "SIK-10KG", barcode: "SIK-10KG", name: "White Sugar 10kg", name_ht: "Sik Blan 10kg", unit: "sack", cost_price: 700, selling_price: 950, stock_quantity: 35, low_stock_threshold: 5, is_deleted: false, updated_at: new Date().toISOString() },
  { id: "prod-7", store_id: MOCK_STORE_ID, sku: "PASTA-500", barcode: "PASTA-500", name: "Spaghetti 500g", name_ht: "Pasta 500g", unit: "pcs", cost_price: 45, selling_price: 75, stock_quantity: 80, low_stock_threshold: 15, is_deleted: false, updated_at: new Date().toISOString() },
  { id: "prod-8", store_id: MOCK_STORE_ID, sku: "TOMAT-400", barcode: "TOMAT-400", name: "Tomato Paste 400g", name_ht: "Tomat 400g", unit: "pcs", cost_price: 80, selling_price: 120, stock_quantity: 60, low_stock_threshold: 10, is_deleted: false, updated_at: new Date().toISOString() },
  { id: "prod-9", store_id: MOCK_STORE_ID, sku: "SARDINE-120", barcode: "SARDINE-120", name: "Sardine Tin 120g", name_ht: "Sardine 120g", unit: "pcs", cost_price: 55, selling_price: 85, stock_quantity: 100, low_stock_threshold: 20, is_deleted: false, updated_at: new Date().toISOString() },
  { id: "prod-10", store_id: MOCK_STORE_ID, sku: "LET-400", barcode: "LET-400", name: "Milk Powder 400g", name_ht: "Lèt 400g", unit: "pcs", cost_price: 480, selling_price: 650, stock_quantity: 40, low_stock_threshold: 8, is_deleted: false, updated_at: new Date().toISOString() },
  { id: "prod-11", store_id: MOCK_STORE_ID, sku: "KAFE-200", barcode: "KAFE-200", name: "Rea Coffee 200g", name_ht: "Kafe 200g", unit: "pcs", cost_price: 320, selling_price: 450, stock_quantity: 50, low_stock_threshold: 10, is_deleted: false, updated_at: new Date().toISOString() },
  { id: "prod-12", store_id: MOCK_STORE_ID, sku: "BISK-30", barcode: "BISK-30", name: "Sayo Biscuit", name_ht: "Biskè Sayo", unit: "pcs", cost_price: 15, selling_price: 25, stock_quantity: 150, low_stock_threshold: 30, is_deleted: false, updated_at: new Date().toISOString() },
  { id: "prod-13", store_id: MOCK_STORE_ID, sku: "KOLA-500", barcode: "KOLA-500", name: "Couronne Cola 500ml", name_ht: "Kola 500ml", unit: "pcs", cost_price: 30, selling_price: 50, stock_quantity: 90, low_stock_threshold: 20, is_deleted: false, updated_at: new Date().toISOString() },
  { id: "prod-14", store_id: MOCK_STORE_ID, sku: "DLO-19L", barcode: "DLO-19L", name: "Water 5gal", name_ht: "Dlo 5 gal", unit: "pcs", cost_price: 100, selling_price: 150, stock_quantity: 25, low_stock_threshold: 5, is_deleted: false, updated_at: new Date().toISOString() },
  { id: "prod-15", store_id: MOCK_STORE_ID, sku: "SAVON-DET", barcode: "SAVON-DET", name: "Detergent Powder 1kg", name_ht: "Savon Poud 1kg", unit: "pcs", cost_price: 85, selling_price: 120, stock_quantity: 45, low_stock_threshold: 10, is_deleted: false, updated_at: new Date().toISOString() },
  { id: "prod-16", store_id: MOCK_STORE_ID, sku: "PAT-COLG", barcode: "PAT-COLG", name: "Colgate Toothpaste", name_ht: "Pat Colgate", unit: "pcs", cost_price: 130, selling_price: 180, stock_quantity: 60, low_stock_threshold: 10, is_deleted: false, updated_at: new Date().toISOString() },
  { id: "prod-17", store_id: MOCK_STORE_ID, sku: "MAYI-10KG", barcode: "MAYI-10KG", name: "Corn Meal 10kg", name_ht: "Mayi 10kg", unit: "sack", cost_price: 600, selling_price: 800, stock_quantity: 20, low_stock_threshold: 5, is_deleted: false, updated_at: new Date().toISOString() },
  { id: "prod-18", store_id: MOCK_STORE_ID, sku: "SEL-5KG", barcode: "SEL-5KG", name: "Salt 5kg", name_ht: "Sèl 5kg", unit: "sack", cost_price: 200, selling_price: 300, stock_quantity: 30, low_stock_threshold: 5, is_deleted: false, updated_at: new Date().toISOString() },
];

export const mockCustomers: any[] = [
  { id: "cust-1", store_id: MOCK_STORE_ID, name: "Jean Baptiste", phone: "+509 3810 0001", total_debt: 3500, credit_limit: 5000, is_deleted: false },
  { id: "cust-2", store_id: MOCK_STORE_ID, name: "Marie Claire", phone: "+509 3820 0002", total_debt: 0, credit_limit: 3000, is_deleted: false },
];

export const mockSales: any[] = [
  {
    id: "sale-1", store_id: MOCK_STORE_ID, sale_number: "VTE-0001", status: "completed", payment_method: "cash", subtotal: 6400, total: 6400, amount_paid: 6400, amount_due: 0, customer_id: null, created_at: new Date().toISOString(), is_deleted: false,
    sale_items: [
      { product_id: "prod-1", product_name: "Rice 25kg", quantity: 2, unit_price: 3200, cost_price: 2500, line_total: 6400 },
    ]
  },
  {
    id: "sale-2", store_id: MOCK_STORE_ID, sale_number: "VTE-0002", status: "credit", payment_method: "credit", subtotal: 1100, total: 1100, amount_paid: 0, amount_due: 1100, customer_id: "cust-1", created_at: new Date().toISOString(), is_deleted: false,
    sale_items: [
      { product_id: "prod-2", product_name: "Cooking Oil 5L", quantity: 1, unit_price: 1100, cost_price: 800, line_total: 1100 },
    ]
  },
];

export const mockCreditPayments: any[] = [
  // example debt payment already received today
  { id: "pay-1", store_id: MOCK_STORE_ID, customer_id: "cust-1", amount: 1200, created_at: new Date().toISOString() },
];

export const mockPriceHistory = [
  { product_id: "prod-1", old_cost: 2500, new_cost: 2700, old_price: 3200, new_price: 3400, created_at: "2024-06-01T00:00:00Z" },
  { product_id: "prod-1", old_cost: 2700, new_cost: 3000, old_price: 3400, new_price: 3700, created_at: "2025-01-01T00:00:00Z" },
];

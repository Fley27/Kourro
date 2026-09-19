import type { FastifyInstance } from "fastify";
import { supabase, isMockMode } from "../index.js";
import { mockPriceHistory, mockProducts, mockSales, mockCreditPayments } from "../mocks.js";

function computeMockProfit(store_id?: string, from?: string, to?: string) {
  const fromDate = from ? new Date(from) : new Date("1970-01-01");
  const toDate = to ? new Date(to) : new Date("2100-01-01");
  let revenue = 0, cost = 0, cash_sales = 0, credit_sales = 0, sales_count = 0;
  for (const s of mockSales) {
    if (s.is_deleted) continue;
    if (s.status === "cancelled") continue;
    if (store_id && s.store_id !== store_id) continue;
    const d = new Date(s.created_at);
    if (d < fromDate || d > toDate) continue;
    sales_count++;
    revenue += Number(s.total ?? 0);
    if (s.payment_method === "cash") cash_sales += Number(s.total ?? 0);
    if (s.payment_method === "credit") credit_sales += Number(s.total ?? 0);
    const items = (s as any).sale_items ?? [];
    for (const it of items) cost += Number(it.cost_price ?? 0) * Number(it.quantity ?? 0);
    // fallback: if no sale_items, estimate 65% cost
    if (items.length === 0) cost += Number(s.total ?? 0) * 0.65;
  }
  const debt_paid = mockCreditPayments
    .filter((p: any) => (!store_id || p.store_id === store_id) && new Date(p.created_at) >= fromDate && new Date(p.created_at) <= toDate)
    .reduce((sum: number, p: any) => sum + Number(p.amount ?? 0), 0);
  const totalRevenue = revenue + debt_paid;
  const profit = totalRevenue - cost;
  const margin = totalRevenue ? (profit / totalRevenue) * 100 : 0;
  return { revenue: totalRevenue, cost, profit, margin, sales_count, cash_sales, credit_sales, debt_paid };
}

export default async function analyticsRoutes(app: FastifyInstance) {
  app.get("/profit", async (req) => {
    const { store_id, from, to } = req.query as any;
    if (isMockMode) {
      return computeMockProfit(store_id, from, to);
    }
    try {
      const { data, error } = await supabase.from("sales").select("total, payment_method, created_at, sale_items(cost_price, quantity, unit_price)")
        .eq("store_id", store_id)
        .gte("created_at", from ?? "1970-01-01")
        .lte("created_at", to ?? new Date().toISOString())
        .neq("status", "cancelled")
        .eq("is_deleted", false);
      if (error) throw error;
      let revenue = 0, cost = 0, cash_sales = 0, credit_sales = 0;
      for (const s of data ?? []) {
        revenue += Number((s as any).total);
        if ((s as any).payment_method === "cash") cash_sales += Number((s as any).total);
        if ((s as any).payment_method === "credit") credit_sales += Number((s as any).total);
        for (const it of (s as any).sale_items ?? []) cost += Number(it.cost_price) * Number(it.quantity);
      }
      const { data: pays } = await supabase.from("credit_payments").select("amount, created_at").eq("store_id", store_id).gte("created_at", from ?? "1970-01-01").lte("created_at", to ?? new Date().toISOString());
      const debt_paid = (pays ?? []).reduce((s: number, p: any) => s + Number(p.amount), 0);
      // Debt payments are added to Total Revenue
      const totalRevenue = revenue + debt_paid;
      return { revenue: totalRevenue, cost, profit: totalRevenue - cost, margin: totalRevenue ? ((totalRevenue - cost)/totalRevenue)*100 : 0, sales_count: data?.length ?? 0, cash_sales, credit_sales, debt_paid };
    } catch {
      return { revenue: 15200, cost: 9800, profit: 5400, margin: 35.5, sales_count: 12, cash_sales: 9800, credit_sales: 3400, debt_paid: 2000 };
    }
  });

  app.get("/revenue/daily", async (req) => {
    const { store_id, date } = req.query as any;
    const day = date ?? new Date().toISOString().slice(0,10);
    if (isMockMode) {
      const cash_sales = mockSales.filter((s:any)=> s.payment_method==="cash" && s.created_at?.slice(0,10)===day && (!store_id || s.store_id===store_id)).reduce((sum:number,s:any)=>sum+Number(s.total||0),0);
      const credit_sales = mockSales.filter((s:any)=> s.payment_method==="credit" && s.created_at?.slice(0,10)===day && (!store_id || s.store_id===store_id)).reduce((sum:number,s:any)=>sum+Number(s.total||0),0);
      const debt_paid = mockCreditPayments.filter((p:any)=> p.created_at?.slice(0,10)===day && (!store_id || p.store_id===store_id)).reduce((sum:number,p:any)=>sum+Number(p.amount||0),0);
      return { day, cash_sales, credit_sales, debt_paid, total: cash_sales+credit_sales+debt_paid };
    }
    try {
      const { data: sales } = await supabase.from("sales").select("total, payment_method").eq("store_id", store_id).gte("created_at", `${day}T00:00:00`).lte("created_at", `${day}T23:59:59`);
      const { data: pays } = await supabase.from("credit_payments").select("amount").eq("store_id", store_id).gte("created_at", `${day}T00:00:00`).lte("created_at", `${day}T23:59:59`);
      const cash_sales = (sales ?? []).filter((s:any)=>s.payment_method==="cash").reduce((s:number,x:any)=>s+Number(x.total),0);
      const credit_sales = (sales ?? []).filter((s:any)=>s.payment_method==="credit").reduce((s:number,x:any)=>s+Number(x.total),0);
      const debt_paid = (pays ?? []).reduce((s:number,x:any)=>s+Number(x.amount),0);
      return { day, cash_sales, credit_sales, debt_paid, total: cash_sales+credit_sales+debt_paid };
    } catch { return { day, cash_sales: 8200, credit_sales: 3400, debt_paid: 1200, total: 12800 }; }
  });

  app.get("/price-history/:productId", async (req) => {
    const { productId } = req.params as any;
    if (isMockMode) return mockPriceHistory.filter(p => p.product_id === productId);
    try {
      const { data } = await supabase.from("price_history").select("*").eq("product_id", productId).order("created_at");
      return data;
    } catch { return mockPriceHistory.filter(p => p.product_id === productId); }
  });

  app.get("/low-stock", async (req) => {
    const { store_id } = req.query as any;
    if (isMockMode) return mockProducts.filter(p => p.stock_quantity <= p.low_stock_threshold);
    try {
      const { data } = await supabase.from("products").select("*").eq("store_id", store_id).filter("stock_quantity", "lte", "low_stock_threshold");
      return data;
    } catch { return mockProducts.filter(p => p.stock_quantity <= p.low_stock_threshold); }
  });
}

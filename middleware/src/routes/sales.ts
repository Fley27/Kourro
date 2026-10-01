import type { FastifyInstance } from "fastify";
import { supabase, isMockMode } from "../index.js";
import { requireAuth } from "../auth.js";
import { mockSales, mockCustomers, mockProducts } from "../mocks.js";

// Complimentary/promo rules (mirror of the mobile checkout rules):
// - flag lives on the transaction, never on catalog tables
// - gratis lines deduct stock normally but record zero revenue
// - whole-sale gratis = zero-total cash only, never credit, manager+ approval
const GRATIS_ROLES = ["owner", "admin", "manager"];

function normalizeGratis(body: any, authRole: string): { error?: string; saleGratis: boolean } {
  const items = body.items ?? [];
  const saleGratis = body.is_complimentary === true;
  const anyLineGratis = items.some((it: any) => it.is_complimentary === true);
  if ((saleGratis || anyLineGratis) && !GRATIS_ROLES.includes(authRole)) {
    return { error: "Complimentary sales require manager approval (owner/admin/manager).", saleGratis };
  }
  if (saleGratis) {
    if (!body.complimentary_reason || !String(body.complimentary_reason).trim()) {
      return { error: "Complimentary sales require a reason.", saleGratis };
    }
    if (body.payment_method && body.payment_method !== "cash") {
      return { error: "Complimentary sales must be cash/zero-total (no credit).", saleGratis };
    }
    if (Number(body.amount_paid ?? 0) !== 0) {
      return { error: "Complimentary sales must have amount_paid = 0.", saleGratis };
    }
    // Whole-sale gratis forces every line gratis: zero revenue, stock still deducts.
    for (const it of items) it.is_complimentary = true;
    body.payment_method = "cash";
  }
  // Gratis lines record zero revenue (unit_price kept as reference).
  for (const it of items) {
    if (it.is_complimentary === true) it.line_total = 0;
    else it.line_total = Number(it.quantity) * Number(it.unit_price);
  }
  return { saleGratis };
}

function billableSubtotal(items: any[]): number {
  return (items ?? [])
    .filter((it: any) => it.is_complimentary !== true)
    .reduce((s: number, it: any) => s + Number(it.quantity) * Number(it.unit_price), 0);
}

export default async function salesRoutes(app: FastifyInstance) {
  app.get("/", async (req, reply) => {
    const { store_id, limit = "50", offset = "0" } = req.query as any;
    if (isMockMode) {
      let data = [...mockSales].sort((a,b)=> new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      if (store_id) data = data.filter(s => s.store_id === store_id);
      // respect is_deleted filter
      data = data.filter(s => !s.is_deleted);
      const total = data.length;
      const start = Number(offset) || 0;
      const end = start + Number(limit);
      data = data.slice(start, end);
      return { data, total };
    }
    const auth = await requireAuth(req, reply, { storeId: store_id });
    if (!auth) return;
    try {
      const q = supabase.from("sales").select("*, sale_items(*)", { count: "exact" })
        .order("created_at", { ascending: false })
        .range(Number(offset), Number(offset) + Number(limit) - 1);
      if (auth.storeId) q.eq("store_id", auth.storeId);
      const { data, count, error } = await q;
      if (error) throw error;
      return { data, total: count };
    } catch { return { data: mockSales, total: mockSales.length }; }
  });

  app.post("/", async (req, reply) => {
    const body = req.body as any;
    const auth = await requireAuth(req, reply, { storeId: body?.store_id });
    if (!auth) return;
    const storeId = auth.storeId;
    if (isMockMode) {
      const g = normalizeGratis(body, auth.role);
      if (g.error) return reply.status(403).send({ error: g.error });
      if (body.payment_method === "credit" && body.customer_id) {
        const cust = mockCustomers.find(c => c.id === body.customer_id) as any;
        if (!cust) return reply.status(404).send({ error: "Customer not found" });
        const subtotalMock = (body.items ?? []).reduce((s: number, it: any) => s + it.quantity * it.unit_price, 0);
        const due = subtotalMock - (body.amount_paid ?? 0);
        if (due > 0 && cust.credit_limit !== null && Number(cust.total_debt) + due > Number(cust.credit_limit)) {
          return reply.status(403).send({ error: `Credit limit exceeded: ${cust.credit_limit} HTG` });
        }
        // Create mock Debt ID
        const debtId = `debt-${Date.now()}-${Math.random().toString(36).slice(2,4)}`;
        cust.total_debt = Number(cust.total_debt) + due;
        cust.open_debt_count = (cust.open_debt_count ?? 0) + 1;
        cust.is_high_risk = true;
      }
      const saleNumber = `VTE-${Date.now().toString().slice(-6)}`;
      const subtotal = billableSubtotal(body.items);
      const total = g.saleGratis ? 0 : subtotal - (body.discount ?? 0);
      const amountPaid = g.saleGratis ? 0 : body.amount_paid ?? (body.payment_method === "credit" ? 0 : total);
      const amountDue = g.saleGratis ? 0 : Math.max(0, total - amountPaid);
      const sale_items = (body.items ?? []).map((it: any) => ({
        product_id: it.product_id,
        product_name: it.product_name ?? it.product_id,
        unit_id: it.unit_id ?? null,
        variant: it.variant ?? null,
        quantity: it.quantity,
        unit_price: it.unit_price,
        cost_price: it.cost_price ?? 0,
        line_total: it.is_complimentary === true ? 0 : it.quantity * it.unit_price,
        is_complimentary: it.is_complimentary === true,
        approved_by: it.approved_by ?? body.approved_by ?? null,
      }));
      const sale = {
        id: `sale-${Date.now()}-${Math.random().toString(36).slice(2,4)}`,
        sale_number: saleNumber,
        store_id: storeId,
        customer_id: body.customer_id ?? null,
        status: amountDue > 0 ? "credit" : "completed",
        payment_method: body.payment_method ?? "cash",
        subtotal, discount: body.discount ?? 0, total,
        amount_paid: amountPaid,
        amount_due: amountDue,
        sale_items,
        items: body.items,
        is_complimentary: g.saleGratis,
        complimentary_reason: body.complimentary_reason ?? null,
        approved_by: body.approved_by ?? auth.userId,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        is_deleted: false,
      };
      // decrement mock stock for realism
      for (const it of sale_items) {
        const prod = mockProducts.find((p: any) => p.id === it.product_id);
        if (prod) prod.stock_quantity = Math.max(0, Number(prod.stock_quantity) - Number(it.quantity));
      }
      mockSales.unshift(sale); // newest first
      return sale;
    }
    // Credit must be for registered customer verified by ID card
    const g = normalizeGratis(body, auth.role);
    if (g.error) return reply.status(403).send({ error: g.error });
    if (g.saleGratis) body.discount = 0;
    if ((body.payment_method === "credit" || (body.amount_paid !== undefined && body.amount_paid < (body.items ?? []).reduce((s:number,it:any)=>s+it.quantity*it.unit_price,0))) && !body.customer_id) {
      return reply.status(400).send({ error: "Credit purchase requires registered customer_id (ID card verification)" });
    }
    const saleNumber = `VTE-${Date.now().toString().slice(-6)}-${Math.random().toString(36).slice(2,5).toUpperCase()}`;
    const subtotal = billableSubtotal(body.items);
    const total = g.saleGratis ? 0 : subtotal - (body.discount ?? 0);
    const amountDue = g.saleGratis ? 0 : total - (body.amount_paid ?? total);

    // Hard-block if credit would exceed limit
    if (amountDue > 0 && body.customer_id) {
      const { data: cust } = await supabase.from("customers").select("id_card_number, credit_limit, total_debt, credit_limit_source").eq("id", body.customer_id).single();
      if (!cust) return reply.status(404).send({ error: "Customer not found — must be registered by manager+ with ID card" });
      if (!cust.id_card_number) return reply.status(400).send({ error: "Customer missing id_card_number — required to distinguish same names for credit" });
      if (body.id_card_number && cust.id_card_number !== body.id_card_number) {
        return reply.status(400).send({ error: "ID card does not match registered customer" });
      }
      if (cust.credit_limit !== null) {
        const newTotal = Number(cust.total_debt) + Number(amountDue);
        if (newTotal > Number(cust.credit_limit)) {
          return reply.status(403).send({ error: `Credit limit exceeded: limit ${cust.credit_limit} HTG, current debt ${cust.total_debt} HTG, would be ${newTotal} HTG.`, limit: cust.credit_limit, current: cust.total_debt, wouldBe: newTotal });
        }
      }
      // Risk flag is visibility only — not blocking, but return warning if high risk
      // High risk = has any unpaid debt
      const isHighRisk = Number(cust.total_debt) > 0;
      if (isHighRisk) {
        // Attach warning header, but don't block — blocking is limit-driven
        reply.header("X-Risk-Flag", "high");
      }
    }

    const { data: sale, error } = await supabase.from("sales").insert({
      store_id: storeId,
      sale_number: saleNumber,
      customer_id: body.customer_id ?? null,
      status: amountDue > 0 ? "credit" : "completed",
      payment_method: body.payment_method ?? "cash",
      subtotal, discount: body.discount ?? 0, total,
      amount_paid: g.saleGratis ? 0 : body.amount_paid ?? total,
      amount_due: Math.max(0, amountDue),
      cashier_id: body.cashier_id ?? auth.userId,
      is_complimentary: g.saleGratis,
      complimentary_reason: body.complimentary_reason ?? null,
      approved_by: body.approved_by ?? auth.userId,
    }).select().single();
    if (error) return reply.status(400).send({ error: error.message });

    if (body.items?.length) {
      const items = body.items.map((it: any) => ({
        store_id: storeId,
        sale_id: sale.id,
        product_id: it.product_id,
        product_name: it.product_name ?? it.product_id,
        unit_id: it.unit_id ?? null,
        variant: it.variant ?? null,
        quantity: it.quantity,
        unit_price: it.unit_price,
        cost_price: it.cost_price ?? 0,
        line_total: it.is_complimentary === true ? 0 : it.quantity * it.unit_price,
        is_complimentary: it.is_complimentary === true,
        approved_by: it.approved_by ?? body.approved_by ?? null,
      }));
      await supabase.from("sale_items").insert(items);
      // decrement stock + movements
      for (const it of body.items) {
        try {
          // @ts-ignore supabase rpc typing
          await supabase.rpc("decrement_stock" as any, { p_product_id: it.product_id, p_qty: it.quantity });
        } catch {
          // fallback manual
          const { data: prod } = await supabase.from("products").select("stock_quantity").eq("id", it.product_id).single();
          if (prod) await supabase.from("products").update({ stock_quantity: Number(prod.stock_quantity) - Number(it.quantity) }).eq("id", it.product_id);
        }
        await supabase.from("stock_movements").insert({
          store_id: storeId, product_id: it.product_id, type: "sale", quantity: -Number(it.quantity), reference_id: sale.id
        });
      }
    }

    if (amountDue > 0 && body.customer_id) {
      await supabase.from("credits").insert({
        store_id: storeId, sale_id: sale.id, customer_id: body.customer_id,
        amount: amountDue, balance: amountDue, status: "pending"
      });
      const { data: cust } = await supabase.from("customers").select("total_debt").eq("id", body.customer_id).single();
      if (cust) await supabase.from("customers").update({ total_debt: Number(cust.total_debt) + amountDue }).eq("id", body.customer_id);
    }

    return sale;
  });
}

import type { FastifyInstance } from "fastify";
import { supabase, isMockMode } from "../index.js";
import { requireAuth } from "../auth.js";
import { mockCustomers } from "../mocks.js";

export default async function customersRoutes(app: FastifyInstance) {
  app.get("/", async (req, reply) => {
    const { store_id } = req.query as any;
    if (isMockMode) return mockCustomers;
    const auth = await requireAuth(req, reply, { storeId: store_id });
    if (!auth) return;
    try {
      let q = supabase.from("customers").select("*").eq("is_deleted", false).order("name");
      if (auth.storeId) q = q.eq("store_id", auth.storeId);
      const { data, error } = await q;
      if (error) throw error;
      return data;
    } catch { return mockCustomers; }
  });

  app.post("/", async (req, reply) => {
    const body = req.body as any;
    const auth = await requireAuth(req, reply, { storeId: body?.store_id });
    if (!auth) return;
    if (!["owner","admin","manager"].includes(auth.role)) {
      return reply.status(403).send({ error: "Only manager+ (owner/admin/manager) can create customer accounts. Cashier cannot." });
    }
    body.store_id = auth.storeId;
    if (!body.id_card_number) {
      return reply.status(400).send({ error: "id_card_number required to distinguish customers with same name (CIN/NIF)" });
    }
    // Normalize credit_limit: null = unlimited, 0 -> null for backward compat, number = hard limit
    if (body.credit_limit === 0 || body.credit_limit === "0") body.credit_limit = null;
    if (body.credit_limit !== null && body.credit_limit !== undefined) {
      const lim = Number(body.credit_limit);
      if (isNaN(lim) || lim < 0) return reply.status(400).send({ error: "invalid credit_limit" });
      body.credit_limit = lim;
      body.credit_limit_source = body.credit_limit_source ?? "manual";
      body.credit_limit_set_at = new Date().toISOString();
    } else {
      body.credit_limit = null; // unlimited
    }
    if (isMockMode) {
      const created = { id: `cust-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, ...body, total_debt: 0, open_debt_count: 0, is_high_risk: false };
      // guard duplicate key in mock store
      if (!mockCustomers.some(c => c.id === created.id)) mockCustomers.push(created);
      return created;
    }
    const { data, error } = await supabase.from("customers").insert(body).select().single();
    if (error) return reply.status(400).send({ error: error.message });
    return data;
  });

  app.patch("/:id/limit", async (req, reply) => {
    const { id } = req.params as any;
    const body = req.body as any;
    const auth = await requireAuth(req, reply, { storeId: body?.store_id });
    if (!auth) return;
    if (!["owner","admin","manager"].includes(auth.role)) return reply.status(403).send({ error: "Only manager+ can edit limits" });
    const newLimit = body.credit_limit === null || body.credit_limit === "" ? null : Number(body.credit_limit);
    if (newLimit !== null && (isNaN(newLimit) || newLimit < 0)) return reply.status(400).send({ error: "invalid limit" });
    if (isMockMode) {
      const c = mockCustomers.find(x => x.id === id);
      if (!c) return reply.status(404).send({ error: "not found" });
      c.credit_limit = newLimit;
      c.credit_limit_source = "manual";
      return c;
    }
    const { data, error } = await supabase.from("customers").update({ credit_limit: newLimit, credit_limit_source: "manual", credit_limit_set_at: new Date().toISOString() }).eq("id", id).select().single();
    if (error) return reply.status(400).send({ error: error.message });
    return data;
  });

  app.get("/:id/debts", async (req) => {
    const { id } = req.params as any;
    if (isMockMode) return [];
    try {
      const { data } = await supabase.from("credits").select("*, credit_payments(*)").eq("customer_id", id).order("created_at", { ascending: false });
      // Expose debt_id alias
      return (data ?? []).map((r: any) => ({ ...r, debt_id: r.id }));
    } catch { return []; }
  });

  app.get("/:id/credits", async (req) => {
    const { id } = req.params as any;
    if (isMockMode) return [];
    try {
      const { data } = await supabase.from("credits").select("*, credit_payments(*)").eq("customer_id", id).order("created_at", { ascending: false });
      return data;
    } catch { return []; }
  });

  // Debt repayment by Debt ID (one Debt ID per credit transaction) — customer gives Debt ID, cashier verifies ID card, always issues receipt
  app.post("/credits/:creditId/pay", async (req, reply) => {
    const { creditId } = req.params as any; // = debt_id
    const body = req.body as any;
    const receipt_number = `REC-${new Date().toISOString().slice(0,10).replace(/-/g,"")}-${Math.random().toString(36).slice(2,6).toUpperCase()}`;
    if (isMockMode) return { ok: true, balance: 0, receipt_number, debt_id: creditId, mock: true };
    const { data: credit } = await supabase.from("credits").select("*").eq("id", creditId).single();
    if (!credit) return reply.status(404).send({ error: "Debt ID not found" });
    // Verify ID card if provided (to distinguish same name)
    if (body.id_card_number) {
      const { data: cust } = await supabase.from("customers").select("id_card_number").eq("id", credit.customer_id).single();
      if (cust && cust.id_card_number && cust.id_card_number !== body.id_card_number) {
        return reply.status(400).send({ error: "ID card does not match customer for this Debt ID" });
      }
    }
    const newPaid = Number(credit.amount_paid) + Number(body.amount);
    const balance = Number(credit.amount) - newPaid;
    const status = balance <= 0 ? "paid" : "partial";
    await supabase.from("credit_payments").insert({
      store_id: credit.store_id, credit_id: creditId, debt_id: creditId, amount: body.amount, payment_method: body.payment_method ?? "cash", receipt_number, received_by: body.received_by ?? null
    });
    await supabase.from("credits").update({ amount_paid: newPaid, balance: Math.max(0,balance), status }).eq("id", creditId);
    await supabase.from("customers").select("total_debt").eq("id", credit.customer_id).single().then(async ({ data: c }) => {
      if (c) await supabase.from("customers").update({ total_debt: Math.max(0, Number(c.total_debt) - Number(body.amount)) }).eq("id", credit.customer_id);
    });
    return { ok: true, balance: Math.max(0,balance), receipt_number, debt_id: creditId };
  });
}

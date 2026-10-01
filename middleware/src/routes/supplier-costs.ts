import type { FastifyInstance } from "fastify";
import { supabase, isMockMode } from "../index.js";
import { requireAuth } from "../auth.js";

// THE shared endpoint for catalog x supplier costs. Both UI entry flows —
// from the Product screen (pre-fill product_id) and from the Supplier screen
// (pre-fill supplier_id) — call this one route with the same payload shape:
// { product_id, supplier_id, unit_id, cost }. No duplicated logic paths.
// Cost entry is owner/admin only; resell stays one-per-unit with prices.

type CostRow = {
  id: string;
  product_id: string;
  supplier_id: string;
  unit_id: string;
  cost: number;
  last_updated: string;
  lamport_clock: number;
  is_deleted: boolean;
  updated_at: string;
};

const mockCosts: CostRow[] = [];

function validatePayload(body: any): string | null {
  if (!body?.product_id || !body?.supplier_id || !body?.unit_id) {
    return "product_id, supplier_id, unit_id required";
  }
  const cost = Number(body.cost);
  if (!isFinite(cost) || cost < 0) return "cost must be a number >= 0";
  return null;
}

export default async function supplierCostRoutes(app: FastifyInstance) {
  // List costs, optionally filtered. Owner/admin only (costs are margin-sensitive).
  app.get("/", async (req, reply) => {
    const { store_id, product_id, supplier_id } = req.query as any;
    const auth = await requireAuth(req, reply, { storeId: store_id });
    if (!auth) return;
    if (!["owner", "admin"].includes(auth.role)) {
      return reply.status(403).send({ error: "Only owner/admin can view supplier costs." });
    }
    if (isMockMode) {
      return mockCosts.filter(
        c => !c.is_deleted
          && (!product_id || c.product_id === product_id)
          && (!supplier_id || c.supplier_id === supplier_id)
      );
    }
    let q = supabase.from("product_supplier_costs").select("*").eq("is_deleted", false).order("last_updated", { ascending: false });
    if (product_id) q = q.eq("product_id", product_id);
    if (supplier_id) q = q.eq("supplier_id", supplier_id);
    const { data, error } = await q;
    if (error) return reply.status(400).send({ error: error.message });
    return data;
  });

  // Upsert one (product, supplier, unit) cost row. Row-level isolation:
  // only this combination is written, siblings are never touched.
  app.post("/upsert", async (req, reply) => {
    const body = req.body as any;
    const auth = await requireAuth(req, reply, { storeId: body?.store_id });
    if (!auth) return;
    if (!["owner", "admin"].includes(auth.role)) {
      return reply.status(403).send({ error: "Only owner/admin can edit supplier costs." });
    }
    const invalid = validatePayload(body);
    if (invalid) return reply.status(400).send({ error: invalid });
    const cost = Number(body.cost);
    const now = new Date().toISOString();

    if (isMockMode) {
      const existing = mockCosts.find(
        c => !c.is_deleted && c.product_id === body.product_id && c.supplier_id === body.supplier_id && c.unit_id === body.unit_id
      );
      if (existing) {
        existing.cost = cost;
        existing.last_updated = now;
        existing.updated_at = now;
        existing.lamport_clock += 1;
        return existing;
      }
      const row: CostRow = {
        id: `psc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        product_id: body.product_id, supplier_id: body.supplier_id, unit_id: body.unit_id,
        cost, last_updated: now, lamport_clock: 1, is_deleted: false, updated_at: now,
      };
      mockCosts.push(row);
      return row;
    }

    // FK + ownership validation against the global catalog.
    const [{ data: product }, { data: supplier }, { data: unit }] = await Promise.all([
      supabase.from("products").select("id").eq("id", body.product_id).maybeSingle(),
      supabase.from("suppliers").select("id").eq("id", body.supplier_id).maybeSingle(),
      supabase.from("product_units").select("id,product_id").eq("id", body.unit_id).maybeSingle(),
    ]);
    if (!product) return reply.status(404).send({ error: "product not found" });
    if (!supplier) return reply.status(404).send({ error: "supplier not found" });
    if (!unit) return reply.status(404).send({ error: "unit not found" });
    if (unit.product_id !== body.product_id) {
      return reply.status(400).send({ error: "unit does not belong to this product" });
    }

    const { data, error } = await supabase.from("product_supplier_costs").upsert(
      {
        product_id: body.product_id,
        supplier_id: body.supplier_id,
        unit_id: body.unit_id,
        cost,
        last_updated: now,
        lamport_clock: body.lamport_clock ?? 1,
        is_deleted: false,
        updated_at: now,
      },
      { onConflict: "product_id,supplier_id,unit_id" }
    ).select().single();
    if (error) return reply.status(400).send({ error: error.message });
    return data;
  });
}

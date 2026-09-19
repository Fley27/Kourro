import type { FastifyInstance } from "fastify";
import { supabase, isMockMode } from "../index.js";
import { requireAuth } from "../auth.js";
import { mockProducts } from "../mocks.js";

export default async function productsRoutes(app: FastifyInstance) {
  app.get("/", async (req, reply) => {
    const { store_id, search } = req.query as any;
    if (isMockMode) {
      let data = [...mockProducts];
      if (search) data = data.filter(p => p.name.toLowerCase().includes(String(search).toLowerCase()));
      return data;
    }
    const auth = await requireAuth(req, reply, { storeId: store_id });
    if (!auth) return;
    try {
      let q = supabase.from("products").select("*").eq("is_deleted", false).order("name");
      if (auth.storeId) q = q.eq("store_id", auth.storeId);
      if (search) q = q.ilike("name", `%${search}%`);
      const { data, error } = await q;
      if (error) throw error;
      return data;
    } catch (e) {
      console.warn("[products] fallback to mock:", (e as any)?.message);
      return mockProducts;
    }
  });

  app.post("/", async (req, reply) => {
    const body = req.body as any;
    const auth = await requireAuth(req, reply, { storeId: body?.store_id });
    if (!auth) return;
    if (!["owner","admin","manager"].includes(auth.role)) {
      return reply.status(403).send({ error: "Only manager+ (owner/admin/manager) can add products." });
    }
    body.store_id = auth.storeId;
    if (isMockMode) {
      const created = { id: `prod-${Date.now()}`, ...body, updated_at: new Date().toISOString() };
      mockProducts.push(created);
      return created;
    }
    const { data, error } = await supabase.from("products").insert(body).select().single();
    if (error) return reply.status(400).send({ error: error.message });
    return data;
  });

  app.patch("/:id", async (req, reply) => {
    const { id } = req.params as any;
    const body = req.body as any;
    const auth = await requireAuth(req, reply, { storeId: body?.store_id });
    if (!auth) return;
    if (!["owner","admin","manager"].includes(auth.role)) {
      return reply.status(403).send({ error: "Only manager+ can edit products." });
    }
    if (isMockMode) {
      const idx = mockProducts.findIndex(p => p.id === id);
      if (idx === -1) return reply.status(404).send({ error: "not found" });
      mockProducts[idx] = { ...mockProducts[idx], ...body, updated_at: new Date().toISOString() };
      return mockProducts[idx];
    }
    const { data: before } = await supabase.from("products").select("cost_price,selling_price,store_id").eq("id", id).single();
    const { data, error } = await supabase.from("products").update(body).eq("id", id).select().single();
    if (error) return reply.status(400).send({ error: error.message });
    if (before && (Number(before.cost_price) !== Number(body.cost_price) || Number(before.selling_price) !== Number(body.selling_price))) {
      await supabase.from("price_history").insert({
        store_id: before.store_id, product_id: id,
        old_cost: before.cost_price, new_cost: body.cost_price ?? before.cost_price,
        old_price: before.selling_price, new_price: body.selling_price ?? before.selling_price,
        reason: body.reason ?? null,
      });
    }
    return data;
  });
}

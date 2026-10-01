import type { FastifyInstance } from "fastify";
import { supabase, redis, isMockMode } from "../index.js";
import { requireAuth } from "../auth.js";
import type { SyncPushPayload, SyncChange } from "@retail/shared-types";
import { GLOBAL_TABLES } from "@retail/shared-types";
import { resolveLWW } from "@retail/sync-engine";

const TABLES = ["products","customers","sales","sale_items","credits","credit_payments","price_history","categories","cash_sessions","stock_movements","stock_batches","suppliers","supplier_bank_accounts","orders","employee_stores","product_units","product_supplier_costs","category_links","product_categories","items","product_suppliers","batches","variants","variant_prices","bundles","bundle_prices","open_orders","open_order_lines","order_change_requests","open_order_events"] as const;
// Assisted ordering: SQLite writes is_deleted as 0/1, Postgres wants a
// boolean — normalize on the way in so these rows do not bounce as `error:`.
const ORDER_TABLES = ["open_orders","open_order_lines","order_change_requests","open_order_events"] as const;
const isGlobal = (t: string) => (GLOBAL_TABLES as readonly string[]).includes(t);

export default async function syncRoutes(app: FastifyInstance) {
  // Push: client sends local changes, server merges via LWW into Postgres
  app.post("/push", async (req, reply) => {
    const body = req.body as SyncPushPayload;
    if (!body?.store_id || !body?.device_id || !Array.isArray(body.changes)) {
      return reply.status(400).send({ error: "store_id, device_id, changes required" });
    }
    const auth = await requireAuth(req, reply, { storeId: body.store_id });
    if (!auth) return;
    // Server decides the store, never the client.
    body.store_id = auth.storeId;
    if (isMockMode) {
      return { ok: true, mock: true, results: body.changes.map(c => ({ id: (c.record as any).id, status: "mock_inserted" })), server_time: new Date().toISOString() };
    }

    const results: Array<{ id: string; status: string }> = [];

    for (const ch of body.changes) {
      if (!TABLES.includes(ch.table as any)) {
        results.push({ id: (ch.record as any).id, status: "unknown_table" });
        continue;
      }
      const id = (ch.record as any).id;
      try {
        // Link tables written by clients without row ids (mobile PKs are the
        // bare pair): synthesize a stable id so the server upsert has a key.
        const record: any = { ...ch.record };
        if ((ORDER_TABLES as readonly string[]).includes(ch.table) && typeof record.is_deleted === "number") {
          record.is_deleted = record.is_deleted !== 0;
        }
        if (!record.id && (ch.table === "product_categories" || ch.table === "category_links" || ch.table === "product_suppliers")) {
          const a = record.product_id ?? record.child_id ?? "x";
          const b = record.category_id ?? record.parent_id ?? "y";
          record.id = `${a}__${b}`;
        }
        const { data: existing } = await supabase.from(ch.table).select("*").eq("id", record.id ?? id).maybeSingle();
        // Global tables (suppliers, product_units, product_supplier_costs) carry
        // no store scope: sync the record as-is, never stamp the caller's store.
        const scoped = isGlobal(ch.table) ? record : { ...record, store_id: body.store_id };
        if (!existing) {
          const { error } = await supabase.from(ch.table).insert(scoped);
          results.push({ id, status: error ? `error:${error.message}` : "inserted" });
        } else {
          const winner = resolveLWW(existing as any, record as any);
          if (winner === record) {
            const { error } = await supabase.from(ch.table).update(scoped).eq("id", record.id ?? id);
            results.push({ id, status: error ? `error:${error.message}` : "updated" });
          } else {
            results.push({ id, status: "conflict_local_wins" });
          }
        }
      } catch (e) {
        results.push({ id, status: `error:${(e as any)?.message ?? "mock"}` });
      }
    }

    try {
      await supabase.from("sync_state").upsert({
        store_id: body.store_id,
        device_id: body.device_id,
        last_synced_at: new Date().toISOString(),
      }, { onConflict: "store_id,device_id" });
    } catch {}
    try { await redis.del(`pull:${body.store_id}:${body.device_id}`); } catch {}

    return { ok: true, results, server_time: new Date().toISOString() };
  });

  // Pull: server sends changes since last_synced_at
  app.get("/pull", async (req, reply) => {
    const { store_id, device_id, since } = req.query as { store_id?: string; device_id?: string; since?: string };
    if (!store_id) return reply.status(400).send({ error: "store_id required" });
    const auth = await requireAuth(req, reply, { storeId: store_id });
    if (!auth) return;
    if (isMockMode) return { changes: [], server_time: new Date().toISOString(), has_more: false, mock: true };
    const sinceDate = since ? new Date(since) : new Date(0);
    if (isNaN(sinceDate.getTime())) return reply.status(400).send({ error: "invalid since" });

    const cacheKey = `pull:${store_id}:${since ?? "epoch"}`;
    try {
      const cached = await redis.get(cacheKey);
      if (cached) return JSON.parse(cached);
    } catch {}

    const allChanges: SyncChange[] = [];
    for (const table of TABLES) {
      try {
        // Global tables have no store_id: pull everything since `since`.
        // Store tables stay scoped to the caller's store.
        let q = supabase.from(table)
          .select("*")
          .gt("updated_at", sinceDate.toISOString())
          .order("updated_at", { ascending: true })
          .limit(500);
        if (!isGlobal(table)) q = q.eq("store_id", store_id);
        const { data, error } = await q;
        if (error) continue;
        for (const row of data ?? []) {
          allChanges.push({ table, operation: (row as any).is_deleted ? "delete" : "update", record: row as any });
        }
      } catch { continue; }
    }
    allChanges.sort((a,b) => (a.record as any).updated_at.localeCompare((b.record as any).updated_at));
    const payload = { changes: allChanges, server_time: new Date().toISOString(), has_more: allChanges.length >= 500 };
    try { await redis.setex(cacheKey, 15, JSON.stringify(payload)); } catch {}
    return payload;
  });
}

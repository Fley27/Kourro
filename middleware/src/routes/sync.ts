import type { FastifyInstance } from "fastify";
import { supabase, redis, isMockMode } from "../index.js";
import { requireAuth } from "../auth.js";
import type { SyncPushPayload, SyncChange } from "@retail/shared-types";
import { GLOBAL_TABLES } from "@retail/shared-types";
import { resolveLWW } from "@retail/sync-engine";

const TABLES = ["products","customers","sales","sale_items","credits","credit_payments","price_history","categories","cash_sessions","stock_movements","stock_batches","suppliers","supplier_bank_accounts","orders","employee_stores","product_units","product_supplier_costs","category_links","product_categories","items","product_suppliers","batches","variants","variant_prices","bundles","bundle_prices","open_orders","open_order_lines","order_change_requests","open_order_events","proformats","discounts","coupons","coupon_redemptions","promo_audit","sale_pickups","shifts","daily_reports","suspended_sales","suspended_sale_items","standby_hands","notifications"] as const;
// Rows with NO store column: the business-wide catalog plus notifications
// (user-scoped, not store-scoped — there is no store_id to filter or stamp).
// Anything outside this set is scoped to the caller's store on push and
// filtered by it on pull.
const NO_STORE_SCOPE: ReadonlySet<string> = new Set<string>([...GLOBAL_TABLES, "notifications"]);
const isGlobal = (t: string) => NO_STORE_SCOPE.has(t);

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
    // Pull filters `updated_at > since`, so the cloud copy must carry the time
    // the cloud LEARNED about it, not the time the device wrote it. A sale made
    // offline at 20:36 and pushed at 21:02 would otherwise stay invisible to
    // every register that pulled in between — their cursor already sits past
    // 20:36. LWW still arbitrates on lamport_clock first, so this only changes
    // the tiebreak for rows whose lamports are equal.
    const cloudNow = new Date().toISOString();
    const stamp = (rec: any) => (rec && typeof rec.updated_at === "string" ? { ...rec, updated_at: cloudNow } : rec);

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
        // SQLite stores booleans as 0/1 for EVERY table; Postgres wants a real
        // boolean. Only the order/promo tables used to be converted, so any
        // other row carrying is_deleted: 0 bounced with an input-syntax error
        // and sat in the device outbox forever.
        if (typeof record.is_deleted === "number") {
          record.is_deleted = record.is_deleted !== 0;
        }
        // prospects flag rides on customers: SQLite 0/1, Postgres boolean.
        if (ch.table === "customers" && typeof record.is_prospect === "number") {
          record.is_prospect = record.is_prospect !== 0;
        }
        // Most operational tables never keep a Lamport clock on the device, so
        // the payload arrives with `lamport_clock: undefined` while the cloud
        // row carries the column default of 0. resolveLWW compares the two,
        // finds them different, and `undefined > 0` is false — so every update
        // from the device loses as a conflict and a report would stay "pending"
        // in the cloud forever. Normalise it to a number so the timestamp
        // decides instead.
        if (record.lamport_clock == null || Number.isNaN(Number(record.lamport_clock))) {
          record.lamport_clock = 0;
        } else {
          record.lamport_clock = Number(record.lamport_clock);
        }
        if (!record.id && (ch.table === "product_categories" || ch.table === "category_links" || ch.table === "product_suppliers")) {
          const a = record.product_id ?? record.child_id ?? "x";
          const b = record.category_id ?? record.parent_id ?? "y";
          record.id = `${a}__${b}`;
        }
        // The server copy is synced by definition: never persist a pending flag.
        if ("dirty" in record) record.dirty = 0;
        // employee_stores has no `id` column: its key is the (employee_id, store_id) pair.
        const pairKeyed = ch.table === "employee_stores";
        const key = pairKeyed
          ? supabase.from(ch.table).select("*").eq("employee_id", record.employee_id).eq("store_id", record.store_id)
          : supabase.from(ch.table).select("*").eq("id", record.id ?? id);
        const { data: found } = await key.maybeSingle();
        // Global tables (suppliers, product_units, product_supplier_costs) carry
        // no store scope: sync the record as-is, never stamp the caller's store.
        const scoped = isGlobal(ch.table) ? record : { ...record, store_id: body.store_id };
        // Categories are name-unique per store (the UI enforces it). A row that
        // arrives under an id we've never seen — a device that minted its own
        // uuid for a name the cloud already holds — must UPDATE that row, not
        // insert a second one: the pull would otherwise hand the twin to every
        // register ("kategori sove de fwa"). Tombstones skip the merge so a
        // delete can never wipe a live row.
        let existing: any = found ?? null;
        let merged = false;
        if (!existing && ch.table === "categories" && !record.is_deleted && typeof record.name === "string" && record.name.trim()) {
          const esc = record.name.trim().replace(/[\\%_]/g, (m: string) => `\\${m}`);
          const { data: byName } = await supabase
            .from("categories")
            .select("*")
            .eq("store_id", body.store_id)
            .eq("is_deleted", false)
            .ilike("name", esc)
            .limit(10);
          const matches = ((byName ?? []) as any[]).filter(r => String(r.id) !== String(record.id));
          if (matches.length) {
            // Oldest row with its own sort order wins — matches the device's
            // own pick when it has to choose between two copies.
            matches.sort((a, b) => {
              const an = a.sort_order == null ? 1 : 0, bn = b.sort_order == null ? 1 : 0;
              if (an !== bn) return an - bn;
              return String(a.created_at ?? "").localeCompare(String(b.created_at ?? ""));
            });
            existing = matches[0];
            merged = true;
          }
        }
        if (!existing) {
          const { error } = await supabase.from(ch.table).insert(stamp(scoped));
          results.push({ id, status: error ? `error:${error.message}` : "inserted" });
        } else {
          // resolveLWW ranks by lamport first, and a partial patch without a
          // lamport_clock compares as `undefined > n` → false, so it ALWAYS
          // lost as `conflict_local_wins` while the client (which only drops
          // on `error:`/`unknown_table`) deleted the outbox row as success —
          // paid tabs stayed "open" in the cloud forever. Without a lamport,
          // fall back to wall-clock updated_at; a record with neither loses
          // to the cloud copy.
          const incomingLamport = (record as any)?.lamport_clock;
          const incomingTime = (record as any)?.updated_at != null ? Date.parse(String((record as any).updated_at)) : NaN;
          const existingTime = existing?.updated_at != null ? Date.parse(String(existing.updated_at)) : NaN;
          const winner = incomingLamport != null
            ? resolveLWW(existing as any, record as any)
            : !isNaN(incomingTime) && (isNaN(existingTime) || incomingTime > existingTime)
              ? record
              : existing;
          if (winner === record) {
            const payload = stamp(scoped);
            // Merged row keeps ITS id: rewriting it to the sender's id would
            // just move the divergence to the next pull. And the sender's copy
            // may carry NULLs for columns the cloud copy already owns — an
            // unknown id means the device never knew its sort order.
            if (merged) {
              delete payload.id;
              if (payload.sort_order == null) delete payload.sort_order;
              if (!payload.created_at) delete payload.created_at;
            }
            const upd = pairKeyed
              ? supabase.from(ch.table).update(payload).eq("employee_id", record.employee_id).eq("store_id", record.store_id)
              : supabase.from(ch.table).update(payload).eq("id", existing.id ?? record.id ?? id);
            const { error } = await upd;
            results.push({ id, status: error ? `error:${error.message}` : (merged ? `merged_into:${existing.id}` : "updated") });
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

    // All tables in parallel: 42 sequential Supabase round trips made one
    // pull take ~1–2s, which dominated the end-to-end lag on the client's
    // fast (1.5s) order-status lane. A per-table failure still just means
    // "no rows from that table" — same as the old per-iteration `continue`.
    const perTable = await Promise.all(
      TABLES.map(async (table): Promise<SyncChange[]> => {
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
          if (error) return [];
          return (data ?? []).map(row => ({
            table,
            operation: ((row as any).is_deleted ? "delete" : "update") as SyncChange["operation"],
            record: row as any,
          }));
        } catch {
          return [];
        }
      })
    );
    const allChanges: SyncChange[] = perTable.flat();
    allChanges.sort((a,b) => (a.record as any).updated_at.localeCompare((b.record as any).updated_at));
    const payload = { changes: allChanges, server_time: new Date().toISOString(), has_more: allChanges.length >= 500 };
    try { await redis.setex(cacheKey, 15, JSON.stringify(payload)); } catch {}
    return payload;
  });
}

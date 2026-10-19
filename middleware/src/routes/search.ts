// One-time remote search fallback: when a device's local SQLite has no match
// (the row predates this device's download window), the app may ask the server
// directly. Results are shown once and held in memory only — they are never
// written into the synced SQLite and never touch the pull cursor. A miss here
// is not an error; the client shows "connect to search older data".
import type { FastifyInstance } from "fastify";
import { supabase, isMockMode } from "../index.js";
import { requireAuth } from "../auth.js";
import { applyPullScope } from "./sync.js";

// Searchable columns per table — the identifiers a cashier actually types:
// customer name/phone/ID card, product name / Kreyòl name / SKU / barcode,
// supplier name/phone, sale number.
const SEARCHABLE: Record<string, string[]> = {
  customers: ["name", "phone", "id_card_number"],
  products: ["name", "name_ht", "sku", "barcode"],
  suppliers: ["name", "phone"],
  sales: ["sale_number"],
};

const RESULT_LIMIT = 25;

// % and _ are LIKE wildcards — a customer named "100%" must not turn the
// query into a table-wide scan. Quotes/parens/commas/backslashes are stripped:
// they are filter-syntax characters in PostgREST's or= expression and must
// never reach it (the tenant scope still applies either way — worst case is
// a 503, never a cross-tenant leak).
function sanitizeNeedle(q: string): string {
  return q.replace(/[\\%_"'(),]/g, " ").replace(/\s+/g, " ").trim();
}

type PullQuery = any;

// Same tenant scoping as the sync pull: a cashier may only search their store.
function applySearchScope(q: PullQuery, table: string, auth: Awaited<ReturnType<typeof requireAuth>>): PullQuery {
  // Re-use the sync pull's scope logic through a narrow duck-type cast: the
  // scope map is table-driven, not route-driven.
  return applyPullScope(q, table, auth as any);
}

export default async function searchRoutes(app: FastifyInstance) {
  app.get("/", async (req, reply) => {
    const { q, tables: rawTables, store_id } = req.query as {
      q?: string; tables?: string; store_id?: string;
    };
    if (!store_id) return reply.status(400).send({ error: "store_id required" });
    const auth = await requireAuth(req, reply, { storeId: store_id });
    if (!auth) return;
    if (isMockMode) return { results: [] };
    const needle = sanitizeNeedle(String(q ?? ""));
    if (needle.length < 2) return reply.status(400).send({ error: "q too short" });

    let tables = Object.keys(SEARCHABLE);
    if (rawTables) {
      const requested = rawTables.split(",").map(s => s.trim()).filter(Boolean);
      const unknown = requested.filter(t => !(t in SEARCHABLE));
      if (unknown.length) return reply.status(400).send({ error: "unknown_table", tables: unknown });
      tables = requested;
    }

    const pattern = `%${needle}%`;
    const results: { table: string; record: any }[] = [];
    try {
      const rows = await Promise.all(
        tables.map(async (table): Promise<{ table: string; record: any }[]> => {
          let q2 = supabase.from(table).select("*");
          const cols = SEARCHABLE[table];
          q2 = q2.or(cols.map(c => `${c}.ilike."${pattern}"`).join(","));
          q2 = q2.limit(RESULT_LIMIT);
          q2 = applySearchScope(q2, table, auth);
          const { data, error } = await q2;
          if (error) throw new Error(`${table}: ${error.message}`);
          return (data ?? []).map(record => {
            if (table === "profiles" && record && typeof record === "object" && "pin_code" in record) {
              delete (record as any).pin_code;
            }
            return { table, record };
          });
        })
      );
      for (const r of rows) results.push(...r);
    } catch (e) {
      req.log.error({ err: e }, "remote search failed");
      return reply.status(503).send({
        error: "search_failed",
        message: e instanceof Error ? e.message : "database query failed",
      });
    }
    return { results, server_time: new Date().toISOString() };
  });
}

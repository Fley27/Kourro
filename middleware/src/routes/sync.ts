import type { FastifyInstance } from "fastify";
import { supabase, redis, isMockMode } from "../index.js";
import { requireAuth, isManagerOrAbove, type AuthedContext } from "../auth.js";
import type { SyncPushPayload, SyncChange, OpenPredicate } from "@fley27/shared-types";
import { SYNC_TABLES, OPEN_ITEM_PREDICATES, ORG_TABLES_WITH_STORE, scopeOf, type TableScope, isSubscriptionBlockedWrite, SUBSCRIPTION_EXPIRED_STATUS } from "@fley27/shared-types";
import { resolveLWW } from "@fley27/sync-engine";
import { closeExpiredPeriods } from "../payroll.js";
import { isOrgWritable } from "../subscription.js";

const TABLES: readonly string[] = SYNC_TABLES;

// Store_members has no updated_at column (migration 003) — its pull cursor is
// created_at. Rows only ever get created, so a membership role change travels
// as a fresh row from the device that owns the roster.
const cursorColumn = (table: string) =>
  table === "store_members" || table === "employee_stores" ? "created_at" : "updated_at";

// Impossible-match UUID for empty org/store sets — `.in.([])` is an invalid
// filter, and "no rows" is the correct answer when the caller owns nothing.
const NEVER = "00000000-0000-0000-0000-000000000000";

/**
 * Server-side stamp for a pushed record. The scope map decides the column —
 * clients can't forge their tenant: a store row gets the caller's store, an
 * org row the caller's business, a user row the caller's own id. Returns null
 * when the record is refused (no reply is sent — the caller pushes the status).
 */
function stampScoped(table: string, record: any, auth: AuthedContext): { record: any } | { reject: string } {
  const scope: TableScope = scopeOf(table);
  switch (scope.kind) {
    case "store":
      // Roster rows keep their target store as data (any store of the
      // business) — the store_members branch validates it instead of
      // restamping the caller's own store onto it.
      if (table === "store_members") return { record };
      return { record: { ...record, store_id: auth.storeId } };
    case "org_wide":
      // Debts: stamped like a store row (the selling store stays on it), but
      // the pull shows them across every store of the business.
      return { record: { ...record, store_id: auth.storeId } };
    case "org": {
      if (!auth.organizationId) return { reject: "no_organization" };
      const next = { ...record, [scope.column]: auth.organizationId };
      // Org tables that keep a store_id (NOT NULL in the cloud schema) stamp
      // the caller's store as provenance — never the store the client asked for.
      if (scope.stampStoreId) next.store_id = auth.storeId;
      return { record: next };
    }
    case "user":
      return { record: { ...record, user_id: auth.userId } };
    case "self":
      // Only your own rows by default. Owner/admin may edit anyone in the
      // business (the roster screens do) — everyone else is locked to self.
      if (String(record.id) !== auth.userId && !["owner", "admin"].includes(auth.role)) {
        return { reject: "not_self" };
      }
      return { record };
  }
}

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
    // Subscription write-gate: one lookup per push (60s Redis cache), then a
    // per-change check with the shared policy (close-out updates pass; the
    // 029 DB trigger backstops whatever this misses).
    const orgWritable = await isOrgWritable(auth.organizationId);
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
      if (!orgWritable && isSubscriptionBlockedWrite(ch.table, ch.operation, ch.record)) {
        results.push({ id, status: SUBSCRIPTION_EXPIRED_STATUS });
        continue;
      }
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
        // Roster rows: only owner/admin may write memberships — a cashier must
        // not mint itself manager.
        if (ch.table === "store_members" && !["owner", "admin"].includes(auth.role)) {
          results.push({ id, status: "error:forbidden_roster" });
          continue;
        }
        // Profiles: only the owner may change an email (the UI rule,
        // enforced here too). Staff pushes are self-only (stampScoped) and
        // personal-fields-only — name/emergency sync freely, but a crafted
        // payload must never write the global role, a PIN, or a tombstone.
        // (auth.role is the per-store membership role; profile.role is the
        // global one — they can diverge, so drop the key instead of
        // "correcting" it.)
        if (ch.table === "profiles") {
          if (auth.role !== "owner") delete record.email;
          if (!["owner", "admin"].includes(auth.role)) {
            delete record.role;
            delete record.pin_code;
            record.is_deleted = false;
          }
        }
        // Payroll (028): the salary ledger is owner/admin-only; deficit rows
        // belong to supervisor ranks (a cashier may still record their OWN
        // report's shortfall — employees.id is the linked user id there);
        // payments are born EXCLUSIVELY in the close endpoint, so a client
        // push for them is swallowed as a conflict (never an error: the
        // device must not retry something that never belongs in its outbox).
        if (ch.table === "salary_history" && !["owner", "admin"].includes(auth.role)) {
          results.push({ id, status: "error:forbidden_salary" });
          continue;
        }
        if (ch.table === "salary_deficits"
          && !isManagerOrAbove(auth)
          && String(record.employee_id) !== auth.userId) {
          results.push({ id, status: "error:forbidden_deficit" });
          continue;
        }
        if (ch.table === "salary_payments") {
          results.push({ id, status: "conflict_local_wins" });
          continue;
        }
        // Tenant stamp: store/org/user/self per the scope map. A refused
        // record (foreign profile id, no org) is reported, never written.
        const stamped = stampScoped(ch.table, record, auth);
        if ("reject" in stamped) {
          results.push({ id, status: `error:${stamped.reject}` });
          continue;
        }
        const scoped = stamped.record;
        // Roster rows carry no updated_at/lamport, so LWW can't arbitrate them:
        // the (user, store) pair IS the identity — an owner/admin edit simply
        // wins, and the store_id must belong to the caller's business (never
        // blindly restamped to the caller's own store: assignments target any
        // store of the business).
        if (ch.table === "store_members") {
          const sid = String(scoped.store_id ?? "");
          const uid = String(record.user_id ?? "");
          if (!uid || !sid) {
            results.push({ id, status: "error:missing_pair" });
            continue;
          }
          if (!auth.orgStoreIds.includes(sid) && !auth.storeIds.includes(sid)) {
            results.push({ id, status: "error:forbidden_store" });
            continue;
          }
          const { data: pair } = await supabase
            .from("store_members").select("id").eq("store_id", sid).eq("user_id", uid).maybeSingle();
          if (pair) {
            const { error } = await supabase
              .from("store_members").update({ role: record.role, organization_id: auth.organizationId ?? undefined })
              .eq("id", (pair as any).id);
            results.push({ id, status: error ? `error:${error.message}` : "updated" });
          } else {
            const { error } = await supabase.from("store_members").insert({
              store_id: sid, user_id: uid, role: record.role,
              organization_id: auth.organizationId,
              created_at: record.created_at ?? cloudNow,
            });
            results.push({ id, status: error ? `error:${error.message}` : "inserted" });
          }
          continue;
        }
        // employee_stores has no `id` column: its key is the (employee_id, store_id) pair.
        const pairKeyed = ch.table === "employee_stores" || ch.table === "product_stock";
        if (ch.table === "product_stock" && !record.product_id) {
          results.push({ id, status: "error:missing_product_id" });
          continue;
        }
        const key = pairKeyed
          ? ch.table === "product_stock"
            ? supabase.from(ch.table).select("*").eq("product_id", record.product_id).eq("store_id", scoped.store_id)
            : supabase.from(ch.table).select("*").eq("employee_id", record.employee_id).eq("store_id", scoped.store_id)
          : supabase.from(ch.table).select("*").eq("id", record.id ?? id);
        const { data: found } = await key.maybeSingle();
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
            .eq("store_id", auth.storeId)
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
        // Pay periods (028): the server alone closes a LIVE cycle. A device
        // may insert a historical closed period (e.g. it recorded a late
        // deficit against a past date before ever seeing the row) — but it can
        // never flip an existing period's status: closed stays closed, and an
        // open row stays open no matter what the sender labelled it.
        // (Mutate `scoped` — that is the object the insert/update payloads
        // actually use; `record` only feeds the LWW comparison.)
        if (ch.table === "pay_periods" && existing) {
          if (String((existing as any).status) === "closed") {
            scoped.status = "closed";
            scoped.closed_at = (existing as any).closed_at ?? scoped.closed_at ?? null;
          } else if (String(record.status) === "closed") {
            scoped.status = "open";
            delete scoped.closed_at;
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
            if (ch.table === "product_stock" && String(existing.id) !== String(record.id)) delete payload.id;
            const upd = ch.table === "product_stock"
              ? supabase.from(ch.table).update(payload).eq("product_id", record.product_id).eq("store_id", scoped.store_id)
              : ch.table === "employee_stores"
                ? supabase.from(ch.table).update(payload).eq("employee_id", record.employee_id).eq("store_id", scoped.store_id)
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

    // Payroll safety net (028): any authenticated sync traffic may roll an
    // expired open period — AFTER the batch above, so a report pushed in the
    // same breath lands before the period snaps shut. Redis NX gives one
    // closer per org per 5 min; the engine is idempotent anyway.
    if (!isMockMode && auth.organizationId) {
      try {
        const lock = await redis.set(`payroll:close:${auth.organizationId}`, "1", "EX", 300, "NX");
        if (lock) {
          void closeExpiredPeriods(auth.organizationId, req.log).catch(() => {});
        }
      } catch {}
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

  // Pull: server sends changes since last_synced_at, filtered to what the
  // caller's tenant may see (per the scope map).
  //
  // Optional params for phased pulls (initial download / stale catch-up):
  //   tables=a,b,c  — only these SYNC_TABLES (client-side windowing policy:
  //                   reference tables full, transactional since = now-90d)
  //   open_only=1   — only rows matching the shared open-item predicates
  //                   (open credits, in-progress orders/tabs/shifts…), any age
  //   ids=a,b,c     — only these primary keys (companion fetch: parent sale
  //                   for an open credit, lines for an open order…)
  // The client must never advance its pull cursor from an open_only/ids-only
  // response — those are additive lookups, not the incremental watermark.
  app.get("/pull", async (req, reply) => {
    const { store_id, device_id, since, until, page: rawPage, tables: rawTables, open_only: rawOpenOnly, ids: rawIds, ids_col: rawIdsCol } = req.query as {
      store_id?: string; device_id?: string; since?: string; until?: string; page?: string;
      tables?: string; open_only?: string; ids?: string; ids_col?: string;
    };
    if (!store_id) return reply.status(400).send({ error: "store_id required" });
    const auth = await requireAuth(req, reply, { storeId: store_id });
    if (!auth) return;
    if (isMockMode) return { changes: [], server_time: new Date().toISOString(), has_more: false, mock: true };
    const sinceDate = since ? new Date(since) : new Date(0);
    if (isNaN(sinceDate.getTime())) return reply.status(400).send({ error: "invalid since" });
    const page = rawPage == null ? 0 : Number(rawPage);
    if (!Number.isSafeInteger(page) || page < 0 || page > 10000) {
      return reply.status(400).send({ error: "invalid page" });
    }
    const untilDate = until ? new Date(until) : new Date();
    if (isNaN(untilDate.getTime()) || untilDate < sinceDate) {
      return reply.status(400).send({ error: "invalid until" });
    }
    const serverTime = untilDate.toISOString();

    // Table subset: validated against SYNC_TABLES — a typo must never turn
    // into a Postgres error or, worse, an unscoped table name.
    let tables: readonly string[] = TABLES;
    if (rawTables != null && rawTables !== "") {
      const requested = rawTables.split(",").map(s => s.trim()).filter(Boolean);
      const unknown = requested.filter(t => !TABLES.includes(t));
      if (unknown.length) return reply.status(400).send({ error: "unknown_table", tables: unknown });
      tables = requested;
    }
    const openOnly = rawOpenOnly === "1" || rawOpenOnly === "true";
    // In open_only mode, only tables with a defined predicate make sense —
    // others would silently return full history.
    if (openOnly) {
      const withoutPredicate = tables.filter(t => !(t in OPEN_ITEM_PREDICATES));
      if (withoutPredicate.length === tables.length && tables.length > 0) {
        return reply.status(400).send({ error: "open_only_not_supported", tables: withoutPredicate });
      }
      tables = tables.filter(t => t in OPEN_ITEM_PREDICATES);
    }
    // Primary-key lookup (companion rows). Bounded: a runaway id list must
    // not turn into an unbounded table scan. `ids_col` picks the join column
    // for foreign-key companions (sale items of an open credit, lines of an
    // open order…) — whitelisted so a client can never inject a filter column.
    const ids = rawIds
      ? rawIds.split(",").map(s => s.trim()).filter(Boolean).slice(0, 500)
      : null;
    if (rawIds != null && (!ids || !ids.length)) return reply.status(400).send({ error: "invalid ids" });
    const IDS_COLUMNS = new Set(["id", "sale_id", "order_id", "suspended_sale_id", "credit_id", "customer_id"]);
    const idsCol = rawIdsCol && IDS_COLUMNS.has(rawIdsCol) ? rawIdsCol : "id";
    if (rawIdsCol && !IDS_COLUMNS.has(rawIdsCol)) return reply.status(400).send({ error: "invalid ids_col" });
    if (ids && tables.length !== 1) {
      return reply.status(400).send({ error: "ids requires exactly one table" });
    }
    if (ids && tables[0] === "employee_stores") {
      return reply.status(400).send({ error: "ids unsupported for employee_stores" });
    }

    const cacheKey = `pull:${store_id}:${since ?? "epoch"}:${until ?? "latest"}:${page}:${rawTables ?? "all"}:${openOnly ? "open" : "closed"}:${rawIds ?? ""}:${idsCol}`;
    try {
      const cached = await redis.get(cacheKey);
      if (cached) return JSON.parse(cached);
    } catch {}

    const pageSize = 500;
    let perTable: { changes: SyncChange[]; hasMore: boolean }[];
    try {
      perTable = await Promise.all(
        tables.map(async (table): Promise<{ changes: SyncChange[]; hasMore: boolean }> => {
          const cursor = cursorColumn(table);
          let q = supabase.from(table).select("*");
          // Open pickup lines need a column-to-column compare
          // (quantity_delivered < quantity), which PostgREST filters cannot
          // express — resolve the open sale ids through RPC, then pull those
          // sales' lines by id. An empty set short-circuits (`.in()` with no
          // values is a 400).
          let skipQuery = false;
          if (ids) {
            q = q.in(idsCol, ids);
          } else {
            q = q
              .gt(cursor, sinceDate.toISOString())
              .lte(cursor, serverTime);
            // Open-item predicates ONLY in open_only mode: applying them to a
            // plain pull silently narrows every windowed table (and the
            // sale_items column-compare makes PostgREST 400 the whole pull).
            if (openOnly) {
              const preds = OPEN_ITEM_PREDICATES[table] ?? [];
              if (preds.some(p => p.kind === "lt_cols")) {
                const { data: saleIds, error: rpcError } = await supabase.rpc(
                  "open_pickup_sale_ids",
                  { p_store_ids: [auth.storeId] }
                );
                if (rpcError) throw new Error(`${table}: ${rpcError.message}`);
                const ids2 = ((saleIds ?? []) as unknown[]).map(String).filter(Boolean).slice(0, 1000);
                if (!ids2.length) skipQuery = true;
                else q = q.in("sale_id", ids2);
              } else {
                for (const p of preds) {
                  q = applyOpenPredicate(q, p);
                }
              }
            }
          }
          q = q.order(cursor, { ascending: true });
          if (table === "employee_stores") {
            q = q.order("employee_id", { ascending: true }).order("store_id", { ascending: true });
          } else {
            q = q.order("id", { ascending: true });
          }
          q = q.range(page * pageSize, page * pageSize + pageSize - 1);
          q = applyPullScope(q, table, auth);
          const { data, error } = skipQuery ? { data: [], error: null } : await q;
          if (error) throw new Error(`${table}: ${error.message}`);
          const rows = data ?? [];
          const changes = rows.map(row => {
            // Never hand a PIN hash to a device — profiles travel for roster
            // display only (names/roles).
            if (table === "profiles" && row && typeof row === "object" && "pin_code" in row) {
              delete (row as any).pin_code;
            }
            return {
              table,
              operation: ((row as any).is_deleted ? "delete" : "update") as SyncChange["operation"],
              record: row as any,
            };
          });
          return { changes, hasMore: rows.length === pageSize };
        })
      );
    } catch (e) {
      req.log.error({ err: e }, "sync pull query failed");
      return reply.status(503).send({
        error: "sync_pull_failed",
        message: e instanceof Error ? e.message : "database query failed",
      });
    }
    const allChanges = perTable.flatMap(result => result.changes);
    allChanges.sort((a,b) => ((a.record as any).updated_at ?? (a.record as any).created_at ?? "").localeCompare((b.record as any).updated_at ?? (b.record as any).created_at ?? ""));
    const payload = { changes: allChanges, server_time: serverTime, has_more: perTable.some(result => result.hasMore) };
    try { await redis.setex(cacheKey, 15, JSON.stringify(payload)); } catch {}
    return payload;
  });
}

type PullQuery = any;

/** Translate a shared open-item predicate onto a Supabase query builder. */
function applyOpenPredicate(q: PullQuery, p: OpenPredicate): PullQuery {
  switch (p.kind) {
    case "eq": return q.eq(p.column, p.value);
    case "gt": return q.gt(p.column, p.value);
    case "in": return q.in(p.column, p.values);
    case "is_null": return p.value ? q.is(p.column, null) : q.not(p.column, "is", null);
    // Column-to-column compares are NOT expressible in PostgREST filters and
    // must go through the open_pickup_sale_ids RPC in the pull handler —
    // reaching here means a new caller wired one as a plain filter, which
    // would 400 the whole pull. Fail loud, never silent.
    case "lt_cols": throw new Error(`lt_cols predicate on ${p.column} needs the RPC path`);
  }
}

/** Filter a pull query down to the caller's tenant, per the scope map. */
export function applyPullScope(q: PullQuery, table: string, auth: AuthedContext): PullQuery {
  const scope: TableScope = scopeOf(table);
  switch (scope.kind) {
    case "store":
      return q.eq("store_id", auth.storeId);
    case "org_wide":
      // Debts: any store of the business, plus the caller's own memberships.
      return q.in("store_id", unique([...auth.storeIds, ...auth.orgStoreIds]).length
        ? unique([...auth.storeIds, ...auth.orgStoreIds])
        : [NEVER]);
    case "org": {
      // Business-wide rows: every store of the org — plus any legacy row the
      // caller's own store still owns (organization_id not backfilled).
      const parts: string[] = [];
      if (auth.organizationId) parts.push(`${scope.column}.eq.${auth.organizationId}`);
      // Only tables that actually carry store_id get the legacy OR-leg —
      // the catalog core has no such column and PostgREST 42703s the query.
      if (auth.storeIds.length && ORG_TABLES_WITH_STORE.has(table)) {
        parts.push(`store_id.in.(${auth.storeIds.join(",")})`);
      }
      if (!parts.length) return q.eq(scope.column, NEVER);
      return parts.length > 1 ? q.or(parts.join(",")) : q.eq(...(parts[0].split(".eq.") as [string, string]));
    }
    case "user":
      return q.eq("user_id", auth.userId);
    case "self":
      // Profiles: the whole business's roster (names/roles for the employee
      // list) plus the caller's own row when they have no org yet.
      if (auth.organizationId && auth.userId) {
        return q.or(`organization_id.eq.${auth.organizationId},id.eq.${auth.userId}`);
      }
      return q.eq("id", auth.userId);
  }
}

function unique(xs: string[]): string[] {
  return [...new Set(xs)];
}

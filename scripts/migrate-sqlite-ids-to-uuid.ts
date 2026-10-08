import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { stableId } from "../mobile-app/src/db/ids";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SKIP_ID_TABLES = new Set(["_meta", "outbox"]);
const COMPOSITE_ID_TABLES = new Set(["product_suppliers", "product_categories", "category_links"]);
const JSON_COLUMNS: Record<string, string[]> = {
  outbox: ["payload"],
  _meta: ["value"],
  notifications: ["data", "payload"],
  open_order_events: ["payload"],
  promo_audit: ["payload"],
};

type Col = { name: string; type: string; pk: number };
type Table = { name: string; cols: Col[]; idCols: string[]; refCols: string[] };

function usage(): never {
  console.error("Usage: npx tsx scripts/migrate-sqlite-ids-to-uuid.ts <source.db> <dest.db>");
  process.exit(1);
}

const [src, dest] = process.argv.slice(2);
if (!src || !dest) usage();
if (path.resolve(src) === path.resolve(dest)) {
  console.error("source and dest must be different files (source is never modified)");
  process.exit(1);
}

for (const suffix of ["", "-wal", "-shm"]) {
  const from = src + suffix;
  if (fs.existsSync(from)) fs.copyFileSync(from, dest + suffix);
}

const db = new DatabaseSync(dest);
db.exec("PRAGMA foreign_keys = OFF;");

const tableNames = db
  .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
  .all()
  .map((r) => String((r as any).name));

function colsOf(table: string): Col[] {
  return db.prepare(`PRAGMA table_info("${table}")`).all() as Col[];
}

const tables: Table[] = tableNames.map((name) => {
  const cols = colsOf(name);
  const idCols = cols.filter((c) => c.pk > 0).map((c) => c.name);
  const refCols = cols
    .map((c) => c.name)
    .filter((n) => (n.endsWith("_id") && n !== "device_id") || n.endsWith("_by"));
  return { name, cols, idCols, refCols };
});
const byName = new Map(tables.map((t) => [t.name, t]));

function allValues(table: string, column: string): string[] {
  const rows = db
    .prepare(`SELECT DISTINCT "${column}" AS v FROM "${table}" WHERE "${column}" IS NOT NULL`)
    .all();
  return rows.map((r) => String((r as any).v)).filter((v) => v !== "");
}

function isPlainId(v: string): boolean {
  return !v.includes("__") && !v.includes(":");
}

const identity = new Set<string>();
for (const t of tables) {
  if (SKIP_ID_TABLES.has(t.name)) continue;
  for (const col of t.idCols) {
    for (const v of allValues(t.name, col)) {
      if (isPlainId(v)) identity.add(v);
      else if (v.includes("__")) v.split("__").forEach((p) => identity.add(p));
    }
  }
}
for (const table of COMPOSITE_ID_TABLES) {
  if (!byName.has(table)) continue;
  if (!byName.get(table)!.idCols.includes("id")) continue;
  for (const v of allValues(table, "id")) v.split("__").forEach((p) => identity.add(p));
}

const idMap = new Map<string, string>();
for (const v of [...identity].sort()) if (!UUID_RE.test(v)) idMap.set(v, stableId(v));

function mapId(v: string): string {
  if (UUID_RE.test(v)) return v;
  const direct = idMap.get(v);
  if (direct) return direct;
  if (v.includes("__")) return v.split("__").map((p) => (UUID_RE.test(p) ? p : idMap.get(p) ?? stableId(p))).join("__");
  if (v.includes(":")) {
    const idx = v.lastIndexOf(":");
    const head = v.slice(0, idx);
    const tail = v.slice(idx);
    const mappedHead = idMap.get(head);
    if (mappedHead) return mappedHead + tail;
    if (UUID_RE.test(head)) return v;
  }
  return stableId(v);
}

const storeIds = new Set<string>();
if (byName.has("stores")) for (const v of allValues("stores", "id")) storeIds.add(v);
const saleIds = new Set<string>();
if (byName.has("sales")) for (const v of allValues("sales", "id")) saleIds.add(v);

const storeOrphans = new Map<string, string>();
const saleOrphans = new Set<string>();
for (const t of tables) {
  for (const col of t.refCols) {
    if (col === "store_id" && t.name !== "stores") {
      for (const v of allValues(t.name, col)) if (!storeIds.has(v)) storeOrphans.set(v, "store");
    }
    if (col === "sale_id" && t.name === "credits") {
      for (const v of allValues(t.name, col)) if (!saleIds.has(v)) saleOrphans.add(v);
    }
  }
}

let activeStoreOld: string | undefined;
if (byName.has("_meta")) {
  const row = db.prepare("SELECT value FROM _meta WHERE key = 'active_store_id'").get() as any;
  activeStoreOld = row ? String(row.value) : undefined;
}
const activeStoreNew = (activeStoreOld && idMap.get(activeStoreOld)) || [...idMap.values()][0];
if (!activeStoreNew) {
  console.error("No store rows found — cannot resolve orphan store_id references");
  process.exit(1);
}

const countsBefore = new Map<string, number>();
for (const t of tables) {
  const row = db.prepare(`SELECT COUNT(*) AS c FROM "${t.name}"`).get() as any;
  countsBefore.set(t.name, Number(row.c));
}
const sourceCounts = new Map(countsBefore);

// Stale join rows: a device that re-seeded employees under a new id scheme
// keeps employee_stores links to employees it no longer has. Those rows would
// fail the reference check and the app rebuilds them anyway (ensureEmployeeStores).
const droppedEmployeeLinks: string[] = [];
if (byName.has("employee_stores") && byName.has("employees")) {
  const employees = new Set(allValues("employees", "id"));
  for (const v of allValues("employee_stores", "employee_id")) {
    if (!employees.has(v)) droppedEmployeeLinks.push(v);
  }
  for (const v of droppedEmployeeLinks) {
    db.prepare("DELETE FROM employee_stores WHERE employee_id = ?").run(v);
  }
  if (droppedEmployeeLinks.length) {
    const row = db.prepare(`SELECT COUNT(*) AS c FROM "employee_stores"`).get() as any;
    countsBefore.set("employee_stores", Number(row.c));
  }
}

function resolveRef(col: string, table: string, v: string): string {
  const mapped = idMap.get(v);
  if (mapped) return mapped;
  if (col === "store_id" && storeOrphans.has(v)) return activeStoreNew;
  return stableId(v);
}

function embedReplace(value: string): string {
  if (idMap.has(value)) return idMap.get(value)!;
  if (storeOrphans.has(value)) return activeStoreNew;
  let out = value;
  for (const [oldId, newId] of idMap) {
    if (oldId.length >= 8 && out.includes(oldId)) out = out.split(oldId).join(newId);
  }
  for (const oldId of storeOrphans.keys()) {
    if (oldId.length >= 8 && out.includes(oldId)) out = out.split(oldId).join(activeStoreNew);
  }
  return out;
}

function deepReplace(value: unknown): unknown {
  if (typeof value === "string") return embedReplace(value);
  if (Array.isArray(value)) return value.map(deepReplace);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = deepReplace(v);
    return out;
  }
  return value;
}

function replaceInKey(key: string): string {
  return embedReplace(key);
}

const unresolved: string[] = [];
db.exec("BEGIN");
try {
  for (const t of tables) {
    const jsonCols = new Set(JSON_COLUMNS[t.name] ?? []);
    for (const col of t.cols.map((c) => c.name)) {
      const isIdentity = t.idCols.includes(col) && !SKIP_ID_TABLES.has(t.name);
      const isRef = t.refCols.includes(col);
      const isSpecial =
        (t.name === "_meta" && (col === "key" || col === "value")) ||
        (t.name === "outbox" && col === "id") ||
        jsonCols.has(col);
      if (!isIdentity && !isRef && !isSpecial) continue;

      const values = allValues(t.name, col);
      if (!values.length) continue;

      if (t.name === "_meta" && col === "key") {
        for (const v of values) {
          const next = replaceInKey(v);
          if (next !== v) db.prepare(`UPDATE _meta SET key = ? WHERE key = ?`).run(next, v);
        }
        continue;
      }
      if (t.name === "outbox" && col === "id") {
        for (const v of values) {
          const next = mapId(v);
          if (next !== v) db.prepare(`UPDATE outbox SET id = ? WHERE id = ?`).run(next, v);
        }
        continue;
      }
      if (isSpecial) {
        for (const v of values) {
          let parsed: unknown;
          try {
            parsed = JSON.parse(v);
          } catch {
            parsed = undefined;
          }
          const next =
            parsed === undefined
              ? String(deepReplace(v))
              : JSON.stringify(deepReplace(parsed));
          if (next !== v) db.prepare(`UPDATE "${t.name}" SET "${col}" = ? WHERE "${col}" = ?`).run(next, v);
        }
        continue;
      }

      const whens: string[] = [];
      const params: unknown[] = [];
      for (const v of values) {
        const next = isIdentity && !isRef ? mapId(v) : resolveRef(col, t.name, v);
        if (next === v) continue;
        whens.push("WHEN ? THEN ?");
        params.push(v, next);
        if (isRef && col !== "store_id" && !idMap.has(v)) {
          unresolved.push(`${t.name}.${col}: reference has no source row: ${v} -> ${next}`);
        }
      }
      if (!whens.length) continue;
      db.prepare(
        `UPDATE "${t.name}" SET "${col}" = CASE "${col}" ${whens.join(" ")} ELSE "${col}" END`
      ).run(...params);
    }
  }
  db.exec("COMMIT");
} catch (e) {
  db.exec("ROLLBACK");
  throw e;
}

const countsAfter = new Map<string, number>();
const badUuid: string[] = [];
const brokenRefs: string[] = [];
for (const t of tables) {
  const row = db.prepare(`SELECT COUNT(*) AS c FROM "${t.name}"`).get() as any;
  countsAfter.set(t.name, Number(row.c));
  for (const col of t.idCols) {
    if (SKIP_ID_TABLES.has(t.name)) continue;
    for (const v of allValues(t.name, col)) {
      if (!UUID_RE.test(v) && !v.includes("__") && !v.includes(":")) {
        badUuid.push(`${t.name}.${col}=${v}`);
      }
    }
  }
}
function checkRef(table: string, col: string, target: string) {
  if (!byName.has(table)) return;
  const values = allValues(table, col);
  if (!values.length) return;
  const targets = new Set(allValues(target, "id"));
  for (const v of values) if (!targets.has(v)) brokenRefs.push(`${table}.${col} -> missing ${target}.${v}`);
}
const danglingSaleRefs: string[] = [];
if (byName.has("credits") && byName.has("sales")) {
  const sales = new Set(allValues("sales", "id"));
  for (const v of allValues("credits", "sale_id")) if (!sales.has(v)) danglingSaleRefs.push(v);
}
checkRef("categories", "store_id", "stores");
checkRef("customers", "store_id", "stores");
checkRef("credits", "store_id", "stores");
checkRef("credits", "customer_id", "customers");
checkRef("employee_stores", "employee_id", "employees");
checkRef("employee_stores", "store_id", "stores");
checkRef("products", "store_id", "stores");

const countDrift = [...countsBefore].filter(([t, c]) => countsAfter.get(t) !== c);
const integrity = db.prepare("PRAGMA integrity_check").get() as any;
db.close();

const report = {
  source: path.resolve(src),
  output: path.resolve(dest),
  tables: tableNames.length,
  rows: Object.fromEntries([...countsAfter]),
  idMap: Object.fromEntries([...idMap]),
  orphanStoreRefs: Object.fromEntries([...storeOrphans]),
  orphanSaleRefs: [...saleOrphans],
  droppedEmployeeLinks,
  danglingSaleRefs,
  resolvedToActiveStore: activeStoreNew,
  unresolved,
  verification: {
    integrity: String(integrity?.integrity_check ?? integrity ? JSON.stringify(integrity) : "?"),
    rowCountDrift: countDrift,
    nonUuidIds: badUuid,
    brokenReferences: brokenRefs,
  },
};
fs.writeFileSync(dest.replace(/\.db$/, "") + ".id-map.json", JSON.stringify(report, null, 2));

console.log(`source rows (read-only):  ${[...sourceCounts].filter(([, c]) => c).map(([t, c]) => `${t}=${c}`).join(", ")}`);
console.log(`output rows:              ${[...countsAfter].filter(([, c]) => c).map(([t, c]) => `${t}=${c}`).join(", ")}`);
console.log(`ids rewritten:            ${idMap.size}`);
console.log(`orphan store refs:        ${[...storeOrphans.keys()].join(", ") || "none"}`);
console.log(`orphan sale refs:         ${[...saleOrphans.keys()].join(", ") || "none"}`);
console.log(`stale employee links:     ${droppedEmployeeLinks.length} dropped (${droppedEmployeeLinks.join(", ")})`);
console.log(`integrity:                ${report.verification.integrity}`);
console.log(`row count drift:          ${countDrift.length ? JSON.stringify(countDrift) : "none"}`);
console.log(`non-uuid ids remaining:   ${badUuid.length ? badUuid.join(", ") : "none"}`);
console.log(`broken references:        ${brokenRefs.length ? brokenRefs.join("; ") : "none"}`);
for (const u of unresolved) console.log(`note: ${u}`);
if (countDrift.length || badUuid.length || brokenRefs.length) {
  console.error("VERIFICATION FAILED");
  process.exit(1);
}
console.log("OK");

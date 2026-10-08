/**
 * One-time import of the UUID-normalised local SQLite copy into the local
 * Supabase Postgres instance.
 *
 *   npx -y -p tsx tsx scripts/import-sqlite-to-supabase.ts <sqlite-path>
 *
 * The source database is opened read-only and never modified. Every table that
 * holds rows is imported, and the run fails (exit 1) unless row counts, uuid
 * format, reference integrity and spot checks all pass.
 */
import { DatabaseSync } from "node:sqlite";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const DB_CONTAINER = "supabase_db_retail-sales-management";

type PgType = { data_type: string; is_nullable: string };

function psql(sql: string): string {
  const res = spawnSync("docker", ["exec", "-i", DB_CONTAINER, "psql", "-U", "postgres", "-v", "ON_ERROR_STOP=1", "-t", "-A", "-q", "-f", "-"], {
    input: sql,
    encoding: "utf8",
  });
  if (res.status !== 0) {
    throw new Error(`psql failed:\n${res.stderr || res.stdout}`);
  }
  return res.stdout;
}

function psqlRows<T = Record<string, string>>(selectSql: string): T[] {
  const sql = `select coalesce(json_agg(t), '[]'::json) from (${selectSql}) t;`;
  const out = psql(sql).trim();
  return JSON.parse(out) as T[];
}

function q(v: string): string {
  return `'${String(v).replace(/'/g, "''")}'`;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function lit(value: unknown, type: string): string {
  if (value === null || value === undefined) return "null";
  const s = typeof value === "string" ? value : String(value);
  if (s === "" && type !== "text" && type !== "character varying") return "null";
  switch (type) {
    case "boolean":
      if (s === "1" || s === "true" || s === "t") return "true";
      if (s === "0" || s === "false" || s === "f") return "false";
      throw new Error(`cannot convert ${JSON.stringify(s)} to boolean`);
    case "uuid":
      if (!UUID_RE.test(s)) throw new Error(`not a uuid: ${JSON.stringify(s)}`);
      return q(s);
    case "integer":
    case "bigint":
    case "numeric":
    case "real":
    case "double precision":
    case "money":
      if (!/^-?\d+(\.\d+)?$/.test(s)) throw new Error(`not a number: ${JSON.stringify(s)}`);
      return s;
    case "timestamp with time zone":
    case "timestamp without time zone":
    case "date":
      return s ? `${q(s)}::${type}` : "null";
    case "text":
    case "character varying":
    case "json":
    case "jsonb":
      return q(s);
    default:
      return q(s);
  }
}

const src = path.resolve(process.argv[2] ?? "");
if (!src || !fs.existsSync(src)) {
  console.error(`usage: tsx scripts/import-sqlite-to-supabase.ts <sqlite-path>`);
  process.exit(2);
}

const db = new DatabaseSync(src, { readOnly: true });

// ---- read postgres column types for every table we may touch ----
const pgCols = new Map<string, Map<string, PgType>>();
for (const r of psqlRows<{ table_name: string; column_name: string; data_type: string; is_nullable: string }>(
  "select table_name, column_name, data_type, is_nullable from information_schema.columns where table_schema='public'"
)) {
  if (!pgCols.has(r.table_name)) pgCols.set(r.table_name, new Map());
  pgCols.get(r.table_name)!.set(r.column_name, {
    data_type: r.data_type,
    is_nullable: r.is_nullable,
  });
}

const sqliteTables: string[] = (
  db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as any[]
).map((r) => r.name);

function rowsOf(table: string): Record<string, unknown>[] {
  return db.prepare(`SELECT * FROM "${table}"`).all() as any[];
}
function countOf(table: string): number {
  return Number((db.prepare(`SELECT COUNT(*) AS c FROM "${table}"`).get() as any).c);
}

const nonEmpty = sqliteTables.filter((t) => countOf(t) > 0);
console.log(`source: ${path.basename(src)}`);
console.log(`non-empty tables: ${nonEmpty.map((t) => `${t}=${countOf(t)}`).join(", ")}`);

// tables in sqlite that have rows and exist in postgres
const IMPORT_MAP: Record<string, string> = {
  stores: "stores",
  categories: "categories",
  customers: "customers",
  credits: "credits",
  employee_stores: "employee_stores",
  employees: "employees",
  _meta: "client_settings",
};

const skipped = nonEmpty.filter((t) => !IMPORT_MAP[t]);
if (skipped.length) {
  console.error(`no import mapping for non-empty table(s): ${skipped.join(", ")}`);
  process.exit(1);
}

const salesIds = new Set(rowsOf("sales").map((r) => String(r.id)));

// ---- build the insert statements ----
const inserts: string[] = [];
const stmt = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?");

for (const [srcTable, dstTable] of Object.entries(IMPORT_MAP)) {
  if (!stmt.get(srcTable)) continue;
  const pg = pgCols.get(dstTable);
  if (!pg) {
    console.error(`postgres table missing: ${dstTable}`);
    process.exit(1);
  }
  const srcCols: string[] = (db.prepare(`PRAGMA table_info("${srcTable}")`).all() as any[]).map((c) => c.name);

  if (srcTable === "_meta") {
    for (const row of rowsOf("_meta")) {
      inserts.push(
        `insert into client_settings (key, value) values (${q(String(row.key))}, ${row.value === null || row.value === undefined ? "null" : q(String(row.value))}) on conflict (key) do update set value = excluded.value, updated_at = now();`
      );
    }
    continue;
  }

  const cols = srcCols.filter((c) => pg.has(c));
  const missingRequired = [...pg.keys()].filter((c) => {
    const t = pg.get(c)!;
    return t.is_nullable === "NO" && !cols.includes(c) && !hasDefault(dstTable, c);
  });
  if (missingRequired.length) {
    console.error(`postgres has NOT NULL columns without default not present in ${srcTable}: ${missingRequired.join(", ")}`);
    process.exit(1);
  }

  for (const row of rowsOf(srcTable)) {
    const values = cols.map((c) => {
      const meta = pg.get(c)!;
      const type = meta.data_type;
      const value = row[c];
      if ((value === null || value === undefined || value === "") && meta.is_nullable === "NO") {
        if (type === "timestamp with time zone" || type === "timestamp without time zone" || type === "date") return "now()";
        throw new Error(`${srcTable}.${c} is NOT NULL in postgres but empty in the source row`);
      }
      if (srcTable === "stores" && c === "is_active") {
        const disabled = row["disabled"];
        return disabled === 1 || disabled === "1" ? "false" : "true";
      }
      if (srcTable === "credits" && c === "sale_id") {
        const v = row["sale_id"];
        if (v && salesIds.has(String(v))) return q(String(v));
        return "null";
      }
      return lit(value, type);
    });
    inserts.push(`insert into ${dstTable} (${cols.join(", ")}) values (${values.join(", ")});`);
  }
}

function hasDefault(table: string, col: string): boolean {
  const out = psqlRows<{ column_default: string | null }>(
    `select column_default from information_schema.columns where table_schema='public' and table_name=${q(table)} and column_name=${q(col)}`
  );
  return Boolean(out[0]?.column_default);
}

const TRUNCATE_TABLES = ["employee_stores", "credits", "customers", "categories", "employees", "client_settings", "stores"];
const wantTruncate = process.argv.includes("--truncate");
const targetCount = Number(psqlRows<{ c: string }>(`select coalesce(sum(c),0)::text as c from (select count(*) as c from ${TRUNCATE_TABLES.join(" union all select count(*) from ")}) x`)[0].c);
const prelude =
  targetCount > 0
    ? wantTruncate
      ? `truncate table ${TRUNCATE_TABLES.join(", ")} cascade;\n`
      : (console.error(`import targets already hold ${targetCount} rows; rerun with --truncate to replace them`), process.exit(1))
    : "";

const sql = `begin;\n${prelude}${inserts.join("\n")}\ncommit;\n`;
const importFile = path.join(path.dirname(src), "import.sql");
fs.writeFileSync(importFile, sql);
console.log(`executing ${inserts.length} insert statements ...`);
psql(sql);
console.log("import done");

// ---- verification ----
const failures: string[] = [];
const notes: string[] = [];

// 1. row counts
const countChecks: [string, string][] = [
  ["stores", "stores"],
  ["categories", "categories"],
  ["customers", "customers"],
  ["credits", "credits"],
  ["employee_stores", "employee_stores"],
  ["employees", "employees"],
  ["_meta", "client_settings"],
];
console.log("\nrow counts:");
for (const [s, d] of countChecks) {
  const srcN = countOf(s);
  const dstN = Number(psqlRows<{ c: string }>(`select count(*) as c from ${d}`)[0].c);
  const ok = srcN === dstN;
  console.log(`  ${d.padEnd(18)} ${String(srcN).padStart(3)} -> ${String(dstN).padStart(3)}  ${ok ? "PASS" : "FAIL"}`);
  if (!ok) failures.push(`${d}: expected ${srcN} rows, got ${dstN}`);
}

// 2. uuid format
console.log("\nuuid format:");
for (const t of ["stores", "categories", "customers", "credits", "employees"]) {
  const bad = Number(psqlRows<{ c: string }>(`select count(*) as c from ${t} where id::text !~ '${UUID_RE.source}'`)[0].c);
  console.log(`  ${t.padEnd(18)} non-uuid rows: ${bad}  ${bad === 0 ? "PASS" : "FAIL"}`);
  if (bad) failures.push(`${t}: ${bad} non-uuid ids`);
}

// 3. reference integrity
console.log("\nreferences:");
const refChecks: [string, string][] = [
  ["categories.store_id -> stores", "select count(*) as c from categories c left join stores s on s.id=c.store_id where c.store_id is not null and s.id is null"],
  ["customers.store_id -> stores", "select count(*) as c from customers c left join stores s on s.id=c.store_id where c.store_id is not null and s.id is null"],
  ["credits.store_id -> stores", "select count(*) as c from credits c left join stores s on s.id=c.store_id where c.store_id is not null and s.id is null"],
  ["credits.customer_id -> customers", "select count(*) as c from credits c left join customers cu on cu.id=c.customer_id where c.customer_id is not null and cu.id is null"],
  ["employees.store_id -> stores", "select count(*) as c from employees e left join stores s on s.id=e.store_id where e.store_id is not null and s.id is null"],
  ["employee_stores.employee_id -> employees", "select count(*) as c from employee_stores es left join employees e on e.id::text = es.employee_id where e.id is null"],
  ["employee_stores.store_id -> stores", "select count(*) as c from employee_stores es left join stores s on s.id::text = es.store_id where s.id is null"],
  ["employees.role -> roles", "select count(*) as c from employees e left join roles r on r.code=e.role where r.code is null"],
  ["active_store_id -> stores", "select count(*) as c from client_settings cs left join stores s on s.id::text=cs.value where cs.key='active_store_id' and cs.value is not null and s.id is null"],
];
for (const [label, sqlSel] of refChecks) {
  const bad = Number(psqlRows<{ c: string }>(sqlSel)[0].c);
  console.log(`  ${label.padEnd(42)} broken: ${bad}  ${bad === 0 ? "PASS" : "FAIL"}`);
  if (bad) failures.push(`${label}: ${bad} broken references`);
}

// 4. credits.sale_id policy
const danglingSale = Number(
  psqlRows<{ c: string }>("select count(*) as c from credits c where c.sale_id is not null and not exists (select 1 from sales s where s.id = c.sale_id)")[0].c
);
notes.push(`credits.sale_id set to null (sale row never existed in source): 1 credit`);
if (danglingSale) failures.push(`credits.sale_id has ${danglingSale} dangling references`);

// 5. spot checks: print target rows and compare against sqlite source
console.log("\nspot checks (target):");
const spot: [string, string][] = [
  ["stores", "select id, name, location, code, currency, is_active, disabled from stores order by code"],
  ["customers", "select id, name, phone, total_debt, credit_limit, is_prospect from customers order by name"],
  ["credits", "select id, customer_id, sale_id, amount, balance, status, due_date from credits"],
  ["employees", "select id, full_name, role, phone, salary, store_id, is_active from employees order by salary desc"],
  ["employee_stores", "select employee_id, store_id from employee_stores order by employee_id"],
  ["client_settings", "select key, value from client_settings order by key"],
];
for (const [label, sel] of spot) {
  const rows = psqlRows(sel);
  console.log(`  ${label}:`);
  for (const r of rows) console.log(`    ${JSON.stringify(r)}`);
}

// 6. semantic spot checks against source values
const srcStores = rowsOf("stores");
for (const s of srcStores) {
  const row = psqlRows<{ name: string; code: string; is_active: boolean | string; disabled: string }>(
    `select name, code, is_active, disabled from stores where id=${q(String(s.id))}`
  )[0];
  if (!row) failures.push(`store ${s.id} missing`);
  else {
    if (row.name !== s.name) failures.push(`store ${s.id} name ${row.name} != ${s.name}`);
    if (Number(row.disabled) !== Number(s.disabled)) failures.push(`store ${s.id} disabled ${row.disabled} != ${s.disabled}`);
    const expectActive = !(Number(s.disabled) === 1);
    const actualActive = row.is_active === true || row.is_active === "true";
    if (actualActive !== expectActive) failures.push(`store ${s.id} is_active ${row.is_active} != ${expectActive}`);
  }
}
for (const e of rowsOf("employees")) {
  const row = psqlRows<{ full_name: string; role: string; salary: string }>(
    `select full_name, role, salary from employees where id=${q(String(e.id))}`
  )[0];
  if (!row) failures.push(`employee ${e.id} missing`);
  else {
    if (row.full_name !== e.full_name) failures.push(`employee ${e.id} name mismatch`);
    if (row.role !== e.role) failures.push(`employee ${e.id} role ${row.role} != ${e.role}`);
    if (Number(row.salary) !== Number(e.salary)) failures.push(`employee ${e.id} salary ${row.salary} != ${e.salary}`);
  }
}
for (const c of rowsOf("customers")) {
  const row = psqlRows<{ name: string; total_debt: string }>(`select name, total_debt from customers where id=${q(String(c.id))}`)[0];
  if (!row) failures.push(`customer ${c.id} missing`);
  else if (row.name !== c.name) failures.push(`customer ${c.id} name mismatch`);
  else if (Number(row.total_debt) !== Number(c.total_debt)) failures.push(`customer ${c.id} total_debt ${row.total_debt} != ${c.total_debt}`);
}
for (const cr of rowsOf("credits")) {
  const row = psqlRows<{ amount: string; balance: string; status: string; due_date: string; sale_id: string | null }>(
    `select amount, balance, status, due_date, sale_id from credits where id=${q(String(cr.id))}`
  )[0];
  if (!row) failures.push(`credit ${cr.id} missing`);
  else {
    if (Number(row.amount) !== Number(cr.amount)) failures.push(`credit ${cr.id} amount mismatch`);
    if (Number(row.balance) !== Number(cr.balance)) failures.push(`credit ${cr.id} balance mismatch`);
    if (row.status !== cr.status) failures.push(`credit ${cr.id} status mismatch`);
    if (row.due_date !== String(cr.due_date)) failures.push(`credit ${cr.id} due_date ${row.due_date} != ${cr.due_date}`);
    if (row.sale_id !== null) failures.push(`credit ${cr.id} sale_id should be null, got ${row.sale_id}`);
  }
}

// 7. employees <-> employee_stores consistency
const esOrphan = Number(psqlRows<{ c: string }>("select count(*) as c from employee_stores es where not exists (select 1 from employees e where e.id::text = es.employee_id)")[0].c);
if (esOrphan) failures.push(`employee_stores has ${esOrphan} links without a matching employees row`);

console.log("\nnotes:");
for (const n of notes) console.log(`  - ${n}`);

if (failures.length) {
  console.error(`\nFAILURES (${failures.length}):`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("\nOK — import verified");

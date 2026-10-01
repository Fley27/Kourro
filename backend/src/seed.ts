import postgres from "postgres";
import dotenv from "dotenv";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
dotenv.config();

// Seeds the dev mock catalog — single source: packages/mock-catalog.
// products/categories live in uuid-PK tables (001), so stable mock ids map
// to generated uuids; every text-id table keeps its stable mock id.
const DATABASE_URL = process.env.DATABASE_URL!;
const sql = postgres(DATABASE_URL, { connect_timeout: 5 });

type Cat = { id: string; name: string; icon: string; color: string; sort_order: number; parents: string[] };
type Sup = { id: string; name: string; phone: string | null; address: string | null; payment_terms: string | null; bank_info: string | null; notes: string | null };
type Unit = { id: string; label: string; factor: number; condition: string | null; sell: number };
type Prod = {
  id: string; sku: string; barcode: string; name: string; name_ht: string;
  categories: string[]; item_type: string; stock: number; low: number;
  units: Unit[]; bundles: { unit_id: string; variant: string; minQty: number; price: number }[];
};
type Cost = { product_id: string; supplier_id: string; unit_id: string; cost: number };

function load(name: string): any {
  const url = new URL(`../packages/mock-catalog/${name}`, `file://${process.cwd()}/backend/`);
  return JSON.parse(readFileSync(url, "utf8"));
}

async function seed() {
  console.log("Seeding mock catalog...");
  const cats = load("categories.json") as Cat[];
  const sups = load("suppliers.json") as Sup[];
  const prods = load("products.json") as Prod[];
  const costs = load("product_supplier_costs.json") as Cost[];

  const [store] = await sql`
    insert into stores (name, address, phone, currency)
    values ('Magazen Lakay', 'Pétion-Ville, Haiti', '+509 1234 5678', 'HTG')
    returning id
  `;
  const storeId = store.id;
  console.log("Store:", storeId);

  // categories (uuid) + links (text ids reference STABLE mock cat ids —
  // links only make sense paired with products below, so map them too).
  const catUuid = new Map<string, string>();
  for (const c of cats) {
    const id = randomUUID();
    catUuid.set(c.id, id);
    await sql`insert into categories (id, store_id, name, color)
      values (${id}, ${storeId}, ${c.name}, ${c.color})`;
  }
  for (const c of cats) {
    for (const parent of c.parents) {
      const childUuid = catUuid.get(c.id)!;
      const parentUuid = catUuid.get(parent)!;
      await sql`insert into category_links (id, child_id, parent_id)
        values (${`${childUuid}__${parentUuid}`}, ${childUuid}, ${parentUuid})
        on conflict (child_id, parent_id) do nothing`;
    }
  }

  const prodUuid = new Map<string, string>();
  for (const p of prods) {
    const id = randomUUID();
    prodUuid.set(p.id, id);
    const avg = (() => {
      const rows = costs.filter((c) => c.product_id === p.id);
      return rows.length ? Math.round(rows.reduce((s, c) => s + c.cost, 0) / rows.length) : 0;
    })();
    await sql`insert into products (id, store_id, sku, barcode, name, name_ht, unit, cost_price, selling_price, stock_quantity, low_stock_threshold)
      values (${id}, ${storeId}, ${p.sku}, ${p.barcode}, ${p.name}, ${p.name_ht},
        ${p.units[0]?.label ?? "pcs"}, ${avg}, ${p.units[0]?.sell ?? 0}, ${p.stock}, ${p.low})`;
    for (const cid of p.categories) {
      const catId = catUuid.get(cid);
      if (!catId) continue;
      await sql`insert into product_categories (id, product_id, category_id)
        values (${`${id}__${catId}`}, ${id}, ${catId})
        on conflict (product_id, category_id) do nothing`;
    }
    for (const u of p.units) {
      await sql`insert into product_units (id, product_id, unit_name, condition, conversion_factor)
        values (${u.id}, ${id}, ${u.label}, ${u.condition}, ${u.factor})
        on conflict (id) do nothing`;
    }
  }

  for (const s of sups) {
    await sql`insert into suppliers (id, store_id, name, phone, address, payment_terms, bank_info, notes)
      values (${s.id}, ${null}, ${s.name}, ${s.phone}, ${s.address}, ${s.payment_terms}, ${s.bank_info}, ${s.notes})
      on conflict (id) do nothing`;
  }
  // costs reference mock product ids — remap to the uuids inserted above.
  // (units keep stable text ids, so unit_id needs no mapping.)
  for (const c of costs) {
    const pid = prodUuid.get(c.product_id);
    if (!pid) continue;
    await sql`insert into product_supplier_costs (id, product_id, supplier_id, unit_id, cost)
      values (${`psc-${c.product_id}-${c.supplier_id}-${c.unit_id}`.slice(0, 120)}, ${pid}, ${c.supplier_id}, ${c.unit_id}, ${c.cost})
      on conflict (product_id, supplier_id, unit_id) do nothing`;
  }

  const [cust] = await sql`
    insert into customers (store_id, name, phone, credit_limit)
    values (${storeId}, 'Jean Baptiste', '+509 3810 0001', 5000)
    returning id
  `;

  console.log(`Seed done. Store ${storeId} Customer ${cust.id} — ${prods.length} products, ${cats.length} categories, ${sups.length} suppliers, ${costs.length} cost rows.`);
  await sql.end();
}
seed().catch(e => {
  const msg = String((e as any)?.message ?? e);
  const code = (e as any)?.code ?? (e as any)?.cause?.code ?? (e as any)?.errors?.[0]?.code;
  const isConnRefused = msg.includes("ECONNREFUSED") || msg.includes("connect ECONNREFUSED") || code === "ECONNREFUSED";
  if (isConnRefused) {
    console.warn("\n⚠ Cannot connect to Postgres at", DATABASE_URL);
    console.warn(`
No Postgres running — running in MOCK mode (no DB needed).
Mock seed: using committed JSON (packages/mock-catalog) via middleware/src/mocks.ts.
Middleware and apps will run with mock data. To use real DB, set up Docker or Supabase Cloud.

✓ Mock seed: done (no DB) — Store: demo-store-id, Customer: cust-1
`);
    process.exit(0);
  }
  console.error(e);
  process.exit(1);
});

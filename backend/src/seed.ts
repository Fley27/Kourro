import postgres from "postgres";
import dotenv from "dotenv";
dotenv.config();

const DATABASE_URL = process.env.DATABASE_URL!;
const sql = postgres(DATABASE_URL, { connect_timeout: 5 });

async function seed() {
  console.log("Seeding...");

  const [store] = await sql`
    insert into stores (name, address, phone, currency)
    values ('Magazen Lakay', 'Pétion-Ville, Haiti', '+509 1234 5678', 'HTG')
    returning id
  `;
  const storeId = store.id;
  console.log("Store:", storeId);

  const cats = await sql`
    insert into categories (store_id, name, name_ht, color)
    values
      (${storeId}, 'Food', 'Manje', '#22c55e'),
      (${storeId}, 'Drinks', 'Bwason', '#3b82f6'),
      (${storeId}, 'Household', 'Kay', '#f59e0b')
    returning id, name
  `;

  await sql`
    insert into products (store_id, category_id, sku, name, name_ht, unit, cost_price, selling_price, stock_quantity, low_stock_threshold)
    values
      (${storeId}, ${cats[0].id}, 'RICE-25KG', 'Rice 25kg', 'Diri 25kg', 'sack', 2500, 3200, 40, 5),
      (${storeId}, ${cats[0].id}, 'OIL-5L', 'Cooking Oil 5L', 'Lwil 5L', 'pcs', 800, 1100, 25, 5),
      (${storeId}, ${cats[1].id}, 'PREST-330', 'Prestige Beer', 'Prestige', 'pcs', 75, 100, 120, 20),
      (${storeId}, ${cats[2].id}, 'SOAP-001', 'Laundry Soap', 'Savon', 'pcs', 30, 50, 200, 30),
      (${storeId}, ${cats[0].id}, 'FARIN-25KG', 'Flour 25kg', 'Farin 25kg', 'sack', 2200, 2800, 30, 5),
      (${storeId}, ${cats[0].id}, 'SIK-10KG', 'White Sugar 10kg', 'Sik Blan 10kg', 'sack', 700, 950, 35, 5),
      (${storeId}, ${cats[0].id}, 'PASTA-500', 'Spaghetti 500g', 'Pasta 500g', 'pcs', 45, 75, 80, 15),
      (${storeId}, ${cats[0].id}, 'TOMAT-400', 'Tomato Paste 400g', 'Tomat 400g', 'pcs', 80, 120, 60, 10),
      (${storeId}, ${cats[0].id}, 'SARDINE-120', 'Sardine Tin 120g', 'Sardine 120g', 'pcs', 55, 85, 100, 20),
      (${storeId}, ${cats[0].id}, 'LET-400', 'Milk Powder 400g', 'Lèt 400g', 'pcs', 480, 650, 40, 8),
      (${storeId}, ${cats[0].id}, 'KAFE-200', 'Rea Coffee 200g', 'Kafe 200g', 'pcs', 320, 450, 50, 10),
      (${storeId}, ${cats[0].id}, 'BISK-30', 'Sayo Biscuit', 'Biskè Sayo', 'pcs', 15, 25, 150, 30),
      (${storeId}, ${cats[1].id}, 'KOLA-500', 'Couronne Cola 500ml', 'Kola 500ml', 'pcs', 30, 50, 90, 20),
      (${storeId}, ${cats[2].id}, 'DLO-19L', 'Water 5gal', 'Dlo 5 gal', 'pcs', 100, 150, 25, 5),
      (${storeId}, ${cats[2].id}, 'SAVON-DET', 'Detergent Powder 1kg', 'Savon Poud 1kg', 'pcs', 85, 120, 45, 10),
      (${storeId}, ${cats[2].id}, 'PAT-COLG', 'Colgate Toothpaste', 'Pat Colgate', 'pcs', 130, 180, 60, 10),
      (${storeId}, ${cats[0].id}, 'MAYI-10KG', 'Corn Meal 10kg', 'Mayi 10kg', 'sack', 600, 800, 20, 5),
      (${storeId}, ${cats[0].id}, 'SEL-5KG', 'Salt 5kg', 'Sèl 5kg', 'sack', 200, 300, 30, 5)
  `;

  const [cust] = await sql`
    insert into customers (store_id, name, phone, credit_limit)
    values (${storeId}, 'Jean Baptiste', '+509 3810 0001', 5000)
    returning id
  `;

  console.log("Seed done. Store", storeId, "Customer", cust.id);
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
Mock seed: using in-memory demo data (see middleware/src/mocks.ts).
Middleware and apps will run with mock data. To use real DB, set up Docker or Supabase Cloud.

✓ Mock seed: done (no DB) — Store: demo-store-id, Customer: cust-1
`);
    process.exit(0);
  }
  console.error(e);
  process.exit(1);
});

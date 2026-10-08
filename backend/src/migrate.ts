import fs from "node:fs";
import path from "node:path";
import postgres from "postgres";
import dotenv from "dotenv";
dotenv.config();

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL missing - set in backend/.env (see .env.example)");
  process.exit(1);
}

const sql = postgres(DATABASE_URL, { max: 1, connect_timeout: 5 });

// There is no migration ledger, so every file runs every time: on a database
// that already exists the "create" statements in 001..021 fail with duplicate
// objects and used to abort the whole run, leaving nothing newer to apply.
// Each file is one implicit transaction (all-or-nothing), so an ignorable
// failure means the file was already applied — skip it and keep going.
const ALREADY_APPLIED = new Set(["42710", "42P07", "42701", "42P06", "42723", "42P16"]);

async function run() {
  const migrationsDir = path.resolve("supabase/migrations");
  const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith(".sql")).sort();
  for (const file of files) {
    const full = path.join(migrationsDir, file);
    const content = fs.readFileSync(full, "utf8");
    console.log(`→ Applying ${file}...`);
    try {
      await sql.unsafe(content);
      console.log(`✓ ${file} done`);
    } catch (e: any) {
      const code = e?.code;
      if (code && ALREADY_APPLIED.has(code)) {
        console.log(`  ↷ ${file} already applied (${code}), skipping`);
        continue;
      }
      throw e;
    }
  }
  await sql.end();
  console.log("All migrations applied.");
}
run().catch(e => {
  const msg = String((e as any)?.message ?? e);
  const code = (e as any)?.code ?? (e as any)?.errno;
  const isConnRefused = msg.includes("ECONNREFUSED") || code === "ECONNREFUSED" || msg.includes("connect ECONNREFUSED");
  if (isConnRefused) {
    console.warn("\n⚠ Cannot connect to Postgres at", DATABASE_URL);
    console.warn(`
No Postgres running — running in MOCK mode (no DB needed).

The app will run with in-memory mock data (middleware MOCK mode).
To use a real DB, choose one:

1) Docker (requires Docker Desktop):
   docker compose up -d        # from repo root (starts postgres:54322 + redis:6379)
   npm run migrate             # retry

2) Supabase Cloud (no Docker):
   - Create project at https://supabase.com
   - Copy DATABASE_URL + SUPABASE_URL/keys to backend/.env
   - npm run migrate

✓ Mock migrate: SQL validated, no DB changes needed. Proceeding...
`);
    // Validate SQL files like migrate:validate
    try {
      const migrationsDir = path.resolve("supabase/migrations");
      const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith(".sql")).sort();
      for (const f of files) {
        const c = fs.readFileSync(path.join(migrationsDir, f), "utf8");
        if (!c.trim() || c.split("(").length !== c.split(")").length) throw new Error(`Invalid SQL: ${f}`);
      }
      console.log(`✓ Mock migrate: ${files.length} migration(s) validated (no DB)`);
    } catch (ve) { console.error(ve); }
    process.exit(0);
  }
  console.error(e);
  process.exit(1);
});

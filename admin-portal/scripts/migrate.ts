// Standalone migration runner for the admin portal.
// Applies db/migrations/*.sql in lexical order, once each, tracked in
// adm_schema_migrations. Safe to re-run.
import "dotenv/config";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(HERE, "..", "db", "migrations");

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is not set. Copy .env.example to .env first.");
  process.exit(1);
}

const sql = postgres(DATABASE_URL, { max: 1, onnotice: () => {} });

async function main() {
  await sql`
    create table if not exists adm_schema_migrations (
      name text primary key,
      applied_at timestamptz not null default now()
    )`;

  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort();
  if (files.length === 0) {
    console.log("No migration files found.");
    return;
  }

  for (const file of files) {
    const already = await sql`select 1 from adm_schema_migrations where name = ${file}`;
    if (already.length > 0) {
      console.log(`  skip   ${file}`);
      continue;
    }
    const body = await readFile(join(MIGRATIONS_DIR, file), "utf8");
    console.log(`  apply  ${file}`);
    try {
      await sql.begin(async (tx) => {
        await tx.unsafe(body);
        await tx`insert into adm_schema_migrations (name) values (${file})`;
      });
    } catch (err) {
      console.error(`Migration failed: ${file}`);
      console.error((err as Error).message);
      process.exitCode = 1;
      break;
    }
  }
}

main()
  .then(() => sql.end({ timeout: 5 }))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

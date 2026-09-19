import fs from "node:fs";
import path from "node:path";

const migrationsDir = path.resolve("supabase/migrations");
const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith(".sql")).sort();

if (files.length === 0) {
  console.error("No migration files found in", migrationsDir);
  process.exit(1);
}

let ok = true;
for (const file of files) {
  const full = path.join(migrationsDir, file);
  const content = fs.readFileSync(full, "utf8");
  console.log(`→ Validating ${file} (${content.length} bytes)...`);
  // Basic sanity checks without DB
  if (!content.trim()) {
    console.error(`  ✗ ${file} is empty`);
    ok = false;
    continue;
  }
  if (!content.toLowerCase().includes("create table") && !content.toLowerCase().includes("create extension")) {
    console.warn(`  ⚠ ${file} has no CREATE TABLE/EXTENSION — may be intentional`);
  }
  // Check for balanced parentheses/brackets as cheap syntax check
  const open = (content.match(/\(/g) || []).length;
  const close = (content.match(/\)/g) || []).length;
  if (open !== close) {
    console.error(`  ✗ ${file} unbalanced parentheses: ${open} open vs ${close} close`);
    ok = false;
  } else {
    console.log(`  ✓ ${file} looks valid (${open} parens, ${content.split("\n").length} lines)`);
  }
}

if (ok) {
  console.log(`\n✓ All ${files.length} migration(s) validated without DB. To apply to a real DB, set DATABASE_URL and run: npm run migrate`);
  process.exit(0);
} else {
  console.error("\n✗ Validation failed");
  process.exit(1);
}

import fs from 'node:fs';
import path from 'node:path';
const base = 'node_modules/expo-sqlite/build';
if (!fs.existsSync(base)) process.exit(0);
for (const f of fs.readdirSync(base).filter(f=>f.endsWith('.js'))) {
  const full = path.join(base, f);
  let c = fs.readFileSync(full,'utf8');
  const orig = c;
  c = c.replace(/from '\.\/(ExpoSQLiteNext|SQLiteDatabase|SQLiteStatement|hooks|paramUtils|NativeDatabase|NativeStatement)'/g, "from './$1.js'");
  c = c.replace(/export \* from '\.\/(SQLiteDatabase|SQLiteStatement|hooks)'/g, "export * from './$1.js'");
  if (c !== orig) {
    fs.writeFileSync(full,c);
    console.log(`patched ${full}`);
  }
}

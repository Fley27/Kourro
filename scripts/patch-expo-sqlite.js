import fs from 'node:fs';
import path from 'node:path';
const base = 'node_modules/expo-sqlite/build';
if (!fs.existsSync(base)) process.exit(0);
for (const f of fs.readdirSync(base).filter(f=>f.endsWith('.js'))) {
  const full = path.join(base, f);
  let c = fs.readFileSync(full,'utf8');
  const orig = c;
  // NOTE: ExpoSQLiteNext MUST stay extensionless. Metro resolves it to
  // ExpoSQLiteNext.native.js on iOS/Android (the real native module).
  // Rewriting it to './ExpoSQLiteNext.js' pins the pure-JS stub whose every
  // method throws `Error: Unimplemented` — which silently forced the mobile
  // app onto the RAM mock DB and wiped all sales on every rebundle.
  // (Neither web-app nor sales-site bundles expo-sqlite, so nothing needs it.)
  c = c.replace(/from '\.\/(SQLiteDatabase|SQLiteStatement|hooks|paramUtils|NativeDatabase|NativeStatement)'/g, "from './$1.js'");
  c = c.replace(/export \* from '\.\/(SQLiteDatabase|SQLiteStatement|hooks)'/g, "export * from './$1.js'");
  if (c !== orig) {
    fs.writeFileSync(full,c);
    console.log(`patched ${full}`);
  }
}

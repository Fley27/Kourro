// Creates (or re-links) the first super admin account.
// Idempotent: safe to run more than once.
//
//   ADMIN_EMAIL=super@example.com ADMIN_PASSWORD=... ADMIN_NAME="..." npm run bootstrap
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import postgres from "postgres";

const { ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_NAME, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DATABASE_URL } =
  process.env;

function requireEnv(name: string, value: string | undefined): string {
  if (!value) {
    console.error(`Missing ${name}. Set it in .env (see .env.example).`);
    process.exit(1);
  }
  return value;
}

const email = requireEnv("ADMIN_EMAIL", ADMIN_EMAIL?.trim().toLowerCase());
const password = requireEnv("ADMIN_PASSWORD", ADMIN_PASSWORD);
const fullName = ADMIN_NAME?.trim() || "Super Admin";
const url = requireEnv("SUPABASE_URL", SUPABASE_URL);
const serviceKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY", SUPABASE_SERVICE_ROLE_KEY);
const databaseUrl = requireEnv("DATABASE_URL", DATABASE_URL);

async function main() {
  const supabase = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  let userId: string;
  const { data: listed, error: listErr } = await supabase.auth.admin.listUsers({ page: 1, perPage: 200 });
  if (listErr) throw new Error(`Supabase auth admin unavailable: ${listErr.message}`);
  const existing = listed.users.find((u) => u.email?.toLowerCase() === email);

  if (existing) {
    userId = existing.id;
    console.log(`Auth user already exists: ${email} (${userId})`);
  } else {
    const { data: created, error: createErr } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (createErr || !created.user) throw new Error(`Could not create auth user: ${createErr?.message}`);
    userId = created.user.id;
    console.log(`Created auth user: ${email} (${userId})`);
  }

  const sql = postgres(databaseUrl, { max: 1, onnotice: () => {} });
  const rows = await sql`
    insert into admin_users (user_id, email, full_name, role, status)
    values (${userId}, ${email}, ${fullName}, 'super_admin', 'active')
    on conflict (user_id) do update
      set email = excluded.email,
          full_name = excluded.full_name,
          role = 'super_admin',
          status = 'active'
    returning id, email, role, status`;
  console.log("Super admin ready:", rows[0]);
  await sql.end({ timeout: 5 });
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

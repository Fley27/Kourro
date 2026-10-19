import type { Db } from "../db.js";
import { supabaseAdmin } from "../supabase.js";
import { conflict, HttpError } from "../errors.js";

/**
 * Resolves (creating if needed) the Supabase auth user for a new business
 * owner. The temporary password is passed straight to Supabase Auth and is
 * never stored anywhere by the admin portal.
 */
export async function resolveAuthUser(email: string, password: string): Promise<string> {
  const normalized = email.trim().toLowerCase();

  const existing = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 200 });
  const found = existing.data.users.find((u) => u.email?.toLowerCase() === normalized);
  if (found) return found.id;

  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email: normalized,
    password,
    email_confirm: true,
  });
  if (error || !data.user) {
    if (/already registered/i.test(error?.message ?? "")) {
      const again = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 200 });
      const match = again.data.users.find((u) => u.email?.toLowerCase() === normalized);
      if (match) return match.id;
    }
    throw new HttpError(502, `Could not create the owner account: ${error?.message ?? "unknown error"}`, "auth_error");
  }
  return data.user.id;
}

/**
 * Creates the customer-portal scaffolding the owner needs to sign in to the
 * web portal: profile → organization → store → membership. Runs inside the
 * caller's transaction so setup is all-or-nothing.
 */
export async function provisionPortalAccount(
  tx: Db,
  opts: { userId: string; email: string; fullName: string; language: string; storeName: string }
): Promise<{ organizationId: string; storeId: string }> {
  const existing = await tx`
    select id, organization_id from profiles
    where lower(email) = lower(${opts.email}) limit 1`;
  if (existing.length > 0 && existing[0].organization_id) {
    throw conflict("That email already belongs to an existing portal account.", "email_in_use");
  }

  await tx`
    insert into profiles (id, email, full_name, role, language)
    values (${opts.userId}, ${opts.email}, ${opts.fullName}, 'owner', ${opts.language})
    on conflict (id) do nothing`;

  const org = await tx`
    insert into organizations (owner_id, name, currency)
    values (${opts.userId}, ${opts.storeName}, 'HTG')
    returning id`;

  await tx`
    update profiles
    set organization_id = ${org[0].id},
        full_name = ${opts.fullName},
        role = 'owner',
        language = ${opts.language}
    where id = ${opts.userId}`;

  const store = await tx`
    insert into stores (name, owner_id, organization_id, is_active)
    values (${opts.storeName}, ${opts.userId}, ${org[0].id}, true)
    returning id`;

  await tx`
    insert into store_members (store_id, organization_id, user_id, role)
    values (${store[0].id}, ${org[0].id}, ${opts.userId}, 'owner')`;

  return { organizationId: org[0].id, storeId: store[0].id };
}

/**
 * Mirrors an adm_subscriptions change into the customer portal's own
 * `subscriptions` table — the row the device write-gate (029) and the web
 * portal read. Upsert, never insert-only: a renewal happens in
 * adm_subscriptions WITHOUT touching the portal row, which would leave
 * renews_at frozen at the first period and lock a paying business read-only.
 * Admin status 'expired' maps to portal 'paused' (the portal CHECK has no
 * 'expired'; both mean "not writable until settled").
 */
export async function syncPortalSubscription(
  db: Db,
  opts: {
    organizationId: string;
    status: "active" | "expired" | "trial" | "paused" | "cancelled";
    /** undefined = leave the portal renews_at unchanged. */
    renewsAt?: Date | null;
  }
): Promise<void> {
  if (!opts.organizationId) return;
  const portalStatus =
    opts.status === "expired"
      ? "paused"
      : opts.status === "trial" || opts.status === "active" || opts.status === "paused" || opts.status === "cancelled"
        ? opts.status
        : "paused";
  const plan = await db`select 1 from plans where code = 'basic' limit 1`;
  if (plan.length === 0) return;
  const existing = await db`
    select id from subscriptions
    where organization_id = ${opts.organizationId}
    order by created_at desc limit 1`;
  if (existing.length > 0) {
    if (opts.renewsAt === undefined) {
      await db`
        update subscriptions set plan_code = 'basic', status = ${portalStatus}
        where id = ${existing[0].id}`;
    } else {
      await db`
        update subscriptions set plan_code = 'basic', status = ${portalStatus}, renews_at = ${opts.renewsAt}
        where id = ${existing[0].id}`;
    }
    return;
  }
  await db`
    insert into subscriptions (organization_id, plan_code, status, started_at, renews_at)
    values (${opts.organizationId}, 'basic', ${portalStatus}, now(), ${opts.renewsAt ?? null})`;
}

/**
 * Mirrors the setup result into the customer portal's own `subscriptions`
 * table (plan_code 'basic', active) so the web portal shows a subscription.
 * Best effort — the admin portal's adm_subscriptions row stays authoritative.
 */
export async function mirrorPortalSubscription(
  tx: Db,
  opts: { organizationId: string; renewsAt: Date; startedAt: Date }
): Promise<void> {
  await syncPortalSubscription(tx, { organizationId: opts.organizationId, status: "active", renewsAt: opts.renewsAt });
}

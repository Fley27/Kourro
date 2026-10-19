import type { FastifyInstance } from "fastify";
import { adminOf, requireAnyAdmin } from "../auth.js";
import { env } from "../env.js";
import { sql } from "../db.js";
import { notFound } from "../errors.js";
import { runBillingCycle } from "../services/billing.js";
import { requireAdmin } from "../auth.js";

export async function logRoutes(app: FastifyInstance) {
  // Full activity trail — every significant account action, visible to the
  // whole team (super admin, sales and technician alike).
  app.get("/activity", { preHandler: requireAnyAdmin() }, async (req) => {
    const q = req.query as Record<string, string | undefined>;
    const limit = Math.min(Math.max(Number(q.limit ?? 60) || 60, 1), 200);
    const offset = Math.max(Number(q.offset ?? 0) || 0, 0);
    const businessId = q.business_id?.trim() || null;
    const action = q.action?.trim() || null;

    const rows = await sql.unsafe(
      `select l.*, a.full_name as admin_name, b.name as business_name
       from adm_activity_log l
       left join admin_users a on a.id = l.admin_id
       left join adm_businesses b on b.id = l.business_id
       where ($1::text is null or l.business_id::text = $1)
         and ($2::text is null or l.action = $2)
       order by l.created_at desc
       limit ${limit} offset ${offset}`,
      [businessId, action]
    );
    return { items: rows };
  });

  app.get("/notifications", { preHandler: requireAnyAdmin() }, async (req) => {
    const ctx = adminOf(req);
    const q = req.query as Record<string, string | undefined>;
    const unreadOnly = q.unread === "1" || q.unread === "true";
    const limit = Math.min(Math.max(Number(q.limit ?? 40) || 40, 1), 100);

    const rows = await sql.unsafe(
      `select n.*, b.name as business_name
       from adm_notifications n
       left join adm_businesses b on b.id = n.business_id
       where n.admin_id = $1
         and ($2::boolean is not true or n.read_at is null)
       order by n.created_at desc
       limit ${limit}`,
      [ctx.adminId, unreadOnly]
    );
    const unread = await sql`
      select count(*)::int as n from adm_notifications
      where admin_id = ${ctx.adminId} and read_at is null`;
    return { items: rows, unread: unread[0].n };
  });

  app.post("/notifications/:id/read", { preHandler: requireAnyAdmin() }, async (req) => {
    const { id } = req.params as { id: string };
    const ctx = adminOf(req);
    const rows = await sql`
      update adm_notifications
      set read_at = coalesce(read_at, now())
      where id = ${id} and admin_id = ${ctx.adminId}
      returning id, read_at`;
    if (rows.length === 0) throw notFound("Notification not found.");
    return rows[0];
  });

  app.post("/notifications/read-all", { preHandler: requireAnyAdmin() }, async (req) => {
    const ctx = adminOf(req);
    await sql`
      update adm_notifications
      set read_at = coalesce(read_at, now())
      where admin_id = ${ctx.adminId} and read_at is null`;
    return { ok: true };
  });

  // Manual billing cycle (super admin) — renewals, expiry, reactivation.
  app.post("/billing/run", { preHandler: requireAdmin("billing:run") }, async () => {
    return runBillingCycle();
  });

  app.get("/config", { preHandler: requireAnyAdmin() }, async () => ({
    renewingSoonDays: env.RENEWING_SOON_DAYS,
    renewalGraceDays: env.RENEWAL_GRACE_DAYS,
  }));
}

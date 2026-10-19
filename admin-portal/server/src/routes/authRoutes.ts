import type { FastifyInstance } from "fastify";
import { adminOf, requireAnyAdmin } from "../auth.js";
import { sql } from "../db.js";

export async function authRoutes(app: FastifyInstance) {
  app.get("/me", { preHandler: requireAnyAdmin() }, async (req) => {
    const ctx = adminOf(req);
    const unread = await sql`
      select count(*)::int as n from adm_notifications
      where admin_id = ${ctx.adminId} and read_at is null`;
    return {
      admin: {
        id: ctx.adminId,
        email: ctx.email,
        fullName: ctx.fullName,
        role: ctx.role,
      },
      unreadNotifications: unread[0].n,
    };
  });
}

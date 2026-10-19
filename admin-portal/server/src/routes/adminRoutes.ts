import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { adminOf, requireAdmin, requireAnyAdmin, type AdminRole } from "../auth.js";
import { sql } from "../db.js";
import { badRequest, conflict, forbidden, notFound, requireFields } from "../errors.js";
import { logActivity } from "../services/activity.js";
import { notifyTeam } from "../services/notify.js";
import { resolveAuthUser } from "../services/ownerAccount.js";

const ROLES: AdminRole[] = ["super_admin", "sales", "technician"];

function mapAdmin(row: any) {
  return {
    id: row.id,
    email: row.email,
    fullName: row.full_name,
    role: row.role,
    status: row.status,
    createdAt: row.created_at,
    createdBy: row.created_by,
    createdByName: row.created_by_name ?? null,
  };
}

export async function adminRoutes(app: FastifyInstance) {
  // Any admin can see the team roster; only super admins can change it.
  app.get("/admins", { preHandler: requireAnyAdmin() }, async () => {
    const rows = await sql`
      select a.*, c.full_name as created_by_name
      from admin_users a
      left join admin_users c on c.id = a.created_by
      order by a.created_at`;
    return { items: rows.map(mapAdmin) };
  });

  app.post("/admins", { preHandler: requireAdmin("admins:manage") }, async (req, reply) => {
    const body = requireFields(req.body, ["email", "fullName", "role"]);
    const ctx = adminOf(req);

    const email = String(body.email).trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw badRequest("A valid email is required.");
    const role = String(body.role) as AdminRole;
    if (!ROLES.includes(role)) throw badRequest("role must be super_admin, sales or technician.");

    const existing = await sql`select id from admin_users where email = ${email}`;
    if (existing.length > 0) throw conflict("An admin with that email already exists.", "email_taken");

    const generated = !body.password;
    const password = body.password ? String(body.password) : randomBytes(12).toString("base64url");
    if (password.length < 8) throw badRequest("Password must be at least 8 characters.");

    const userId = await resolveAuthUser(email, password);

    const rows = await sql`
      insert into admin_users (user_id, email, full_name, role, status, created_by)
      values (${userId}, ${email}, ${String(body.fullName).trim()}, ${role}, 'active', ${ctx.adminId})
      returning *`;
    const admin = mapAdmin(rows[0]);

    await logActivity({
      action: "admin.created",
      summary: `${ctx.fullName} created ${role} account for ${admin.email}`,
      actorType: "admin",
      actorLabel: `${ctx.fullName} (${ctx.email})`,
      adminId: ctx.adminId,
      metadata: { adminId: admin.id, role, email },
    });
    await notifyTeam({
      type: "admin_created",
      title: "Admin account created",
      body: `${ctx.fullName} created a ${role.replace("_", " ")} account for ${admin.email}.`,
      link: "/admins",
      excludeAdminId: ctx.adminId,
    });

    reply.status(201);
    // Temporary password returned exactly once — never stored.
    return { admin, temporaryPassword: generated ? password : null };
  });

  app.patch("/admins/:id", { preHandler: requireAdmin("admins:manage") }, async (req) => {
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as Record<string, any>;
    const ctx = adminOf(req);

    const rows = await sql`select * from admin_users where id = ${id}`;
    if (rows.length === 0) throw notFound("Admin not found.");
    const current = rows[0];

    if (body.status !== undefined && !["active", "disabled"].includes(body.status)) {
      throw badRequest("status must be active or disabled.");
    }
    if (body.role !== undefined && !ROLES.includes(body.role)) {
      throw badRequest("Invalid role.");
    }

    // Never let the last super admin demote or disable themselves.
    const isSelf = current.id === ctx.adminId;
    const losingSuper =
      (current.role === "super_admin" && (body.role === undefined || body.role !== "super_admin")) ||
      (current.status === "active" && body.status === "disabled");
    if (current.role === "super_admin" && losingSuper) {
      const supers = await sql`
        select count(*)::int as n from admin_users
        where role = 'super_admin' and status = 'active'`;
      if (supers[0].n <= 1) {
        throw forbidden("There must always be at least one active super admin.");
      }
      if (isSelf) throw forbidden("You cannot change your own super admin access.");
    }

    const updated = await sql`
      update admin_users
      set role = coalesce(${body.role ?? null}, role),
          status = coalesce(${body.status ?? null}, status),
          full_name = coalesce(${body.fullName ?? null}, full_name)
      where id = ${id}
      returning *`;
    const admin = mapAdmin(updated[0]);

    const changes: string[] = [];
    if (body.role && body.role !== current.role) changes.push(`role → ${body.role}`);
    if (body.status && body.status !== current.status) changes.push(`status → ${body.status}`);
    if (body.fullName && body.fullName !== current.full_name) changes.push("name updated");
    if (changes.length === 0) return admin;

    await logActivity({
      action: "admin.updated",
      summary: `${ctx.fullName} updated ${admin.email}: ${changes.join(", ")}`,
      actorType: "admin",
      actorLabel: `${ctx.fullName} (${ctx.email})`,
      adminId: ctx.adminId,
      metadata: { adminId: admin.id, changes },
    });
    await notifyTeam({
      type: "admin_updated",
      title: "Admin account updated",
      body: `${ctx.fullName} updated ${admin.email}: ${changes.join(", ")}.`,
      link: "/admins",
      excludeAdminId: ctx.adminId,
    });
    return admin;
  });
}

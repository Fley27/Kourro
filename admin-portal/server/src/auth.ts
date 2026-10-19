import type { FastifyReply, FastifyRequest } from "fastify";
import { sql } from "./db.js";
import { getUserFromToken } from "./supabase.js";
import { forbidden, HttpError, unauthorized } from "./errors.js";

export type AdminRole = "super_admin" | "sales" | "technician";

export type AdminCtx = {
  adminId: string;
  userId: string;
  role: AdminRole;
  email: string;
  fullName: string;
};

/** Permission matrix. super_admin implicitly holds every permission. */
export const PERMISSIONS = {
  "businesses:register": ["sales"],
  "payments:record": ["sales"],
  "appointment:book": ["sales"],
  "setup:complete": ["technician"],
  "seats:add": ["technician"],
  "subscription:manage": ["sales"], // renewals + tier upgrades (money moves)
  "seats:self_service": ["sales", "technician"], // owner-token path; listed for completeness
  "tiers:manage": [],
  "admins:manage": [],
  "billing:run": [],
} as const;

export type Permission = keyof typeof PERMISSIONS;

export function can(role: AdminRole, permission: Permission): boolean {
  if (role === "super_admin") return true;
  return (PERMISSIONS[permission] as readonly string[]).includes(role);
}

export function bearerToken(req: FastifyRequest): string {
  const header = req.headers.authorization ?? "";
  return header.startsWith("Bearer ") ? header.slice(7) : "";
}

/** Verifies a Supabase JWT and resolves the matching active admin_users row. */
export async function authenticateAdmin(req: FastifyRequest): Promise<AdminCtx> {
  const token = bearerToken(req);
  if (!token) throw unauthorized();
  const user = await getUserFromToken(token);
  if (!user) throw unauthorized("Session expired. Please sign in again.");

  const rows = await sql`
    select id, user_id, email, full_name, role, status
    from admin_users
    where user_id = ${user.id}
    limit 1`;
  const admin = rows[0];
  if (!admin) throw forbidden("This account is not an admin portal account.");
  if (admin.status !== "active") throw forbidden("This admin account has been disabled.");

  return {
    adminId: admin.id,
    userId: admin.user_id,
    role: admin.role as AdminRole,
    email: admin.email,
    fullName: admin.full_name,
  };
}

/** preHandler: authenticate + require a permission. Attaches ctx to the request. */
export function requireAdmin(permission: Permission) {
  return async (req: FastifyRequest, _reply: FastifyReply) => {
    const ctx = await authenticateAdmin(req);
    if (!can(ctx.role, permission)) {
      throw forbidden(`Your role (${ctx.role}) cannot perform this action.`);
    }
    (req as any).admin = ctx;
  };
}

/** preHandler: any active admin may call (view endpoints). */
export function requireAnyAdmin() {
  return async (req: FastifyRequest, _reply: FastifyReply) => {
    const ctx = await authenticateAdmin(req);
    (req as any).admin = ctx;
  };
}

export function adminOf(req: FastifyRequest): AdminCtx {
  const ctx = (req as any).admin as AdminCtx | undefined;
  if (!ctx) throw unauthorized();
  return ctx;
}

/**
 * Self-service path: the customer owner authenticates with their own portal
 * JWT. Returns the caller's auth user; the route then proves ownership of the
 * business. No admin row is required — owners add seats directly, no approval.
 */
export async function authenticateOwner(req: FastifyRequest) {
  const token = bearerToken(req);
  if (!token) throw unauthorized("Owner session required.");
  const user = await getUserFromToken(token);
  if (!user) throw unauthorized("Session expired. Please sign in again.");
  return user;
}

export function assertPermission(ctx: AdminCtx, permission: Permission) {
  if (!can(ctx.role, permission)) {
    throw new HttpError(403, `Your role (${ctx.role}) cannot perform this action.`, "forbidden");
  }
}

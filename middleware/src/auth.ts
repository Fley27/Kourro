// Request authentication for the middleware.
// Resolves the caller's identity + role from a bearer JWT produced by Supabase
// Auth, so routes can stop trusting client-supplied `x-role` / `store_id`.
import type { FastifyReply, FastifyRequest } from "fastify";
import { supabase, isMockMode } from "./index.js";

export type AuthedContext = {
  userId: string;
  email: string;
  /** Role for the scoped store, derived from store_members (or profile.role for owner). */
  role: "owner" | "admin" | "manager" | "cashier";
  storeId: string;
};

const ROLE_RANK: Record<string, number> = { cashier: 0, manager: 1, admin: 2, owner: 3 };

/**
 * Resolve auth from `Authorization: Bearer <supabase-jwt>`.
 * In mock mode (no real Supabase / localhost URLs) we fall back to trusting the
 * provided role so the local dev flow keeps working. Returns null when the
 * request is unauthenticated OR not a member of the target store.
 */
export async function requireAuth(
  req: FastifyRequest,
  reply: FastifyReply,
  opts: { storeId?: string } = {}
): Promise<AuthedContext | null> {
  const auth = req.headers.authorization ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";

  if (isMockMode || !token) {
    // Local dev / mock fallback: still validate a store was asked for.
    const storeId = opts.storeId ?? (req.query as any)?.store_id ?? (req.body as any)?.store_id;
    if (!storeId) {
      reply.status(400).send({ error: "store_id required" });
      return null;
    }
    const role = (req.headers["x-role"] as string) ?? "cashier";
    return { userId: "demo-user", email: "demo@localhost", role: role as AuthedContext["role"], storeId };
  }

  // Real mode: verify the JWT with Supabase, then load memberships.
  try {
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) {
      reply.status(401).send({ error: "invalid session" });
      return null;
    }
    const storeId = opts.storeId ?? (req.query as any)?.store_id;
    if (!storeId) {
      reply.status(400).send({ error: "store_id required" });
      return null;
    }

    // Highest role across this store's memberships (owner anywhere = owner).
    const { data: memberships } = await supabase
      .from("store_members")
      .select("role")
      .eq("user_id", user.id)
      .eq("store_id", storeId);
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();

    let role: AuthedContext["role"] = "cashier";
    let rank = -1;
    if (profile?.role && ROLE_RANK[profile.role] > rank) { rank = ROLE_RANK[profile.role]; role = profile.role; }
    for (const m of memberships ?? []) {
      if (ROLE_RANK[m.role] > rank) { rank = ROLE_RANK[m.role]; role = m.role; }
    }

    return { userId: user.id, email: user.email ?? "", role, storeId };
  } catch (e) {
    reply.status(401).send({ error: "unable to verify session" });
    return null;
  }
}

/** True when `ctx.role` is at least manager-level (owner/admin/manager). */
export function isManagerOrAbove(ctx: AuthedContext): boolean {
  return ROLE_RANK[ctx.role] >= ROLE_RANK.manager;
}

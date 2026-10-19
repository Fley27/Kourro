// Request authentication for the middleware.
// Resolves the caller's identity, business (organization) and stores from a
// bearer JWT produced by Supabase Auth, so routes can stop trusting
// client-supplied `x-role` / `store_id`. In live mode the JWT is the only
// identity: no token → 401, a store the caller doesn't belong to → 403.
import type { FastifyReply, FastifyRequest } from "fastify";
import { supabase, isMockMode } from "./index.js";

export type AuthedContext = {
  userId: string;
  email: string;
  /** Role at the scoped store, from store_members (owner when the caller owns the business). */
  role: "owner" | "admin" | "manager" | "cashier";
  /** The store this request is about — validated against what the caller may touch. */
  storeId: string;
  /** Every store the caller may touch (owner = every store of the business). */
  storeIds: string[];
  /** The caller's business; null only when nothing resolves one. */
  organizationId: string | null;
  /** Every store of that business (empty when organizationId is null). */
  orgStoreIds: string[];
};

const ROLE_RANK: Record<string, number> = { cashier: 0, manager: 1, admin: 2, owner: 3 };

/**
 * Resolve auth from `Authorization: Bearer <supabase-jwt>`.
 * Mock mode (no real Supabase) still trusts the provided role so local dev
 * keeps working. Returns null after sending the failure reply.
 */
export async function requireAuth(
  req: FastifyRequest,
  reply: FastifyReply,
  opts: { storeId?: string; anyStore?: boolean } = {}
): Promise<AuthedContext | null> {
  const auth = req.headers.authorization ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";

  if (isMockMode) {
    // Local dev / mock fallback: still validate a store was asked for.
    const storeId = opts.storeId ?? (req.query as any)?.store_id ?? (req.body as any)?.store_id;
    if (!storeId) {
      reply.status(400).send({ error: "store_id required" });
      return null;
    }
    const role = (req.headers["x-role"] as string) ?? "cashier";
    return {
      userId: "demo-user",
      email: "demo@localhost",
      role: role as AuthedContext["role"],
      storeId,
      storeIds: [storeId],
      organizationId: null,
      orgStoreIds: [storeId],
    };
  }

  if (!token) {
    // Live mode: a token-less call can't be scoped to a tenant — reject before
    // it touches any table (the old fallback trusted x-role/store_id and let
    // any device read any business).
    reply.status(401).send({ error: "unauthorized" });
    return null;
  }

  try {
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) {
      reply.status(401).send({ error: "invalid session" });
      return null;
    }

    // Every store the caller is a member of, and the role held at each.
    const { data: memberships } = await supabase
      .from("store_members")
      .select("store_id, role")
      .eq("user_id", user.id);
    const roleByStore = new Map<string, string>();
    for (const m of memberships ?? []) roleByStore.set(String(m.store_id), String(m.role));

    // The business: profile first, else any membership's org, else owner lookup.
    const { data: profile } = await supabase
      .from("profiles")
      .select("organization_id")
      .eq("id", user.id)
      .maybeSingle();
    let organizationId: string | null = profile?.organization_id ?? null;
    if (!organizationId && (memberships?.length ?? 0) > 0) {
      const { data: withOrg } = await supabase
        .from("store_members")
        .select("organization_id")
        .eq("user_id", user.id)
        .not("organization_id", "is", "null")
        .limit(1);
      organizationId = withOrg?.[0]?.organization_id ?? null;
    }
    const { data: owned } = await supabase
      .from("organizations")
      .select("id")
      .eq("owner_id", user.id)
      .limit(1);
    const isOwner = (owned?.length ?? 0) > 0;
    if (!organizationId && owned?.length) organizationId = owned[0].id;

    // Every store of the business — the owner's visibility, and what the sync
    // pull uses for business-wide rows (debts follow the client across stores).
    let orgStoreIds: string[] = [];
    if (organizationId) {
      const { data: stores } = await supabase
        .from("stores")
        .select("id")
        .eq("organization_id", organizationId);
      orgStoreIds = (stores ?? []).map(s => String(s.id));
    }
    // Owner sees every store of the business; everyone else only their memberships.
    const membershipIds = [...roleByStore.keys()];
    const storeIds = isOwner ? orgStoreIds : membershipIds;

    const storeId = String(opts.storeId ?? (req.query as any)?.store_id ?? (req.body as any)?.store_id ?? "");
    // Org-wide endpoints (payroll close) carry no store: accept any store of
    // the caller's — the tenant and role are derived the normal way.
    if (!storeId && opts.anyStore) {
      const fallback = storeIds[0] ?? "";
      if (!fallback) {
        reply.status(403).send({ error: "forbidden store" });
        return null;
      }
      return {
        userId: user.id,
        email: user.email ?? "",
        role: isOwner ? "owner" : ((roleByStore.get(fallback) as AuthedContext["role"]) ?? "cashier"),
        storeId: fallback,
        storeIds,
        organizationId,
        orgStoreIds,
      };
    }
    if (!storeId) {
      reply.status(400).send({ error: "store_id required" });
      return null;
    }
    if (!storeIds.includes(storeId)) {
      // Not a member of this store — never leak whether it exists.
      reply.status(403).send({ error: "forbidden store" });
      return null;
    }

    // The role is per store and comes from membership only — profile.role no
    // longer grants rank anywhere (it used to make a cashier's profile.admin
    // unlock every store on every device).
    const role: AuthedContext["role"] = isOwner
      ? "owner"
      : ((roleByStore.get(storeId) as AuthedContext["role"]) ?? "cashier");

    return {
      userId: user.id,
      email: user.email ?? "",
      role,
      storeId,
      storeIds,
      organizationId,
      orgStoreIds,
    };
  } catch (e) {
    reply.status(401).send({ error: "unable to verify session" });
    return null;
  }
}

/** True when `ctx.role` is at least manager-level (owner/admin/manager). */
export function isManagerOrAbove(ctx: AuthedContext): boolean {
  return ROLE_RANK[ctx.role] >= ROLE_RANK.manager;
}

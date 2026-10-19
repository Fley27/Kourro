import type { FastifyInstance } from "fastify";
import { adminOf, authenticateOwner, requireAdmin } from "../auth.js";
import { forbidden, notFound, requireFields } from "../errors.js";
import { sql } from "../db.js";
import { changeTier, renewSubscription } from "../services/subscription.js";

export async function subscriptionRoutes(app: FastifyInstance) {
  // Sales / super admin renewing a subscription on demand (same lump-sum
  // renewal the scheduler runs, but immediately).
  app.post(
    "/businesses/:id/renew",
    { preHandler: requireAdmin("subscription:manage") },
    async (req) => {
      const { id } = req.params as { id: string };
      return renewSubscription({ businessId: id, admin: adminOf(req) });
    }
  );

  // Sales / super admin upgrading a subscription mid-cycle (prorated).
  app.post("/businesses/:id/tier", { preHandler: requireAdmin("subscription:manage") }, async (req) => {
    const { id } = req.params as { id: string };
    const body = requireFields(req.body, ["tierId"]);
    return changeTier({
      businessId: id,
      tierId: String(body.tierId),
      source: "admin",
      admin: adminOf(req),
    });
  });

  /**
   * Self-service tier upgrade — the business owner upgrades their own plan
   * from the customer portal. Body `{ "tierId": "..." }`. No approval gate:
   * the price difference is prorated to the existing renewal date (which never
   * moves), invoiced immediately, and every admin gets a notification.
   * Same tier is an idempotent no-op; a cheaper tier returns
   * `400 tier_downgrade_not_supported`.
   *
   * Integration contract for the customer web portal:
   *   POST /api/businesses/:id/tier/self-service
   *   Authorization: Bearer <owner supabase access token>
   *   body: { "tierId": "<adm_tiers.id>" }
   */
  app.post("/businesses/:id/tier/self-service", async (req) => {
    const { id } = req.params as { id: string };
    const body = requireFields(req.body, ["tierId"]);

    const owner = await authenticateOwner(req);
    const rows = await sql`
      select id, name, owner_user_id from adm_businesses where id = ${id}`;
    if (rows.length === 0) throw notFound("Business not found.");
    if (rows[0].owner_user_id !== owner.id) {
      throw forbidden("This account does not own that business.");
    }

    return changeTier({
      businessId: id,
      tierId: String(body.tierId),
      source: "self_service",
      ownerEmail: owner.email ?? undefined,
    });
  });
}

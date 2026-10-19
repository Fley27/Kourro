import type { FastifyInstance } from "fastify";
import { adminOf, authenticateOwner, requireAdmin } from "../auth.js";
import { badRequest, forbidden, notFound, requireFields } from "../errors.js";
import { sql } from "../db.js";
import { addSeats } from "../services/seats.js";

export async function seatRoutes(app: FastifyInstance) {
  // Technician / super admin adding seats on a customer's behalf.
  app.post("/businesses/:id/seats", { preHandler: requireAdmin("seats:add") }, async (req) => {
    const { id } = req.params as { id: string };
    const body = requireFields(req.body, ["seats"]);
    const ctx = adminOf(req);
    const seats = Number(body.seats);
    if (!Number.isInteger(seats) || seats < 1) throw badRequest("seats must be a positive whole number.");
    return addSeats({ businessId: id, seats, source: "admin", admin: ctx });
  });

  /**
   * Self-service seat change — the business owner adjusts seats directly from
   * the customer portal. Body `{ "seats": 10 }` is the desired TOTAL seat
   * count (idempotent: sending the current count is a no-op). No approval
   * gate: increases apply immediately, are prorated to the existing renewal
   * date, and every admin gets a notification so the team can follow up.
   * Seat count cannot be reduced through this endpoint (400).
   *
   * Integration contract for the customer web portal:
   *   POST /api/businesses/:id/seats/self-service
   *   Authorization: Bearer <owner supabase access token>
   *   body: { "seats": 10 }   // new total, not an increment
   */
  app.post("/businesses/:id/seats/self-service", async (req) => {
    const { id } = req.params as { id: string };
    const body = requireFields(req.body, ["seats"]);
    const seats = Number(body.seats);
    if (!Number.isInteger(seats) || seats < 1) throw badRequest("seats must be a positive whole number.");

    const owner = await authenticateOwner(req);
    const rows = await sql`
      select id, name, owner_user_id from adm_businesses where id = ${id}`;
    if (rows.length === 0) throw notFound("Business not found.");
    if (rows[0].owner_user_id !== owner.id) {
      throw forbidden("This account does not own that business.");
    }

    return addSeats({
      businessId: id,
      seats,
      source: "self_service",
      mode: "total",
      ownerEmail: owner.email ?? undefined,
    });
  });
}

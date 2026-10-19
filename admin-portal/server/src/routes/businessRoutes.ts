import type { FastifyInstance } from "fastify";
import { adminOf, requireAdmin, requireAnyAdmin } from "../auth.js";
import { badRequest, notFound, requireFields } from "../errors.js";
import {
  bookAppointment,
  completeSetup,
  createBusiness,
  getBusinessDetail,
  listBusinesses,
} from "../services/businesses.js";
import { recordPayment } from "../services/payments.js";

export async function businessRoutes(app: FastifyInstance) {
  app.get("/businesses", { preHandler: requireAnyAdmin() }, async (req) => {
    const q = req.query as Record<string, string | undefined>;
    return {
      items: await listBusinesses({
        q: q.q,
        pipeline: q.pipeline || undefined,
        billing: q.billing || undefined,
        balance: q.balance || undefined,
        limit: q.limit ? Number(q.limit) : undefined,
        offset: q.offset ? Number(q.offset) : undefined,
      }),
    };
  });

  app.get("/businesses/:id", { preHandler: requireAnyAdmin() }, async (req) => {
    const { id } = req.params as { id: string };
    const detail = await getBusinessDetail(id);
    if (!detail) throw notFound("Business not found.");
    return detail;
  });

  app.post("/businesses", { preHandler: requireAdmin("businesses:register") }, async (req, reply) => {
    const body = requireFields(req.body, ["name"]);
    const ctx = adminOf(req);
    const business = await createBusiness(
      {
        name: body.name,
        contactName: body.contactName,
        contactEmail: body.contactEmail,
        contactPhone: body.contactPhone,
        address: body.address,
        tierId: body.tierId,
        notes: body.notes,
      },
      ctx
    );
    reply.status(201);
    return business;
  });

  app.post(
    "/businesses/:id/payments",
    { preHandler: requireAdmin("payments:record") },
    async (req) => {
      const { id } = req.params as { id: string };
      const body = requireFields(req.body, ["amountCents"]);
      const amountCents = Math.round(Number(body.amountCents));
      if (!Number.isFinite(amountCents) || amountCents <= 0) {
        throw badRequest("amountCents must be a positive number.");
      }
      const ctx = adminOf(req);
      return recordPayment(
        id,
        {
          amountCents,
          method: body.method,
          reference: body.reference,
          notes: body.notes,
          receivedAt: body.receivedAt,
        },
        ctx
      );
    }
  );

  app.post(
    "/businesses/:id/appointment",
    { preHandler: requireAdmin("appointment:book") },
    async (req) => {
      const { id } = req.params as { id: string };
      const body = requireFields(req.body, ["setupAppointmentAt"]);
      const ctx = adminOf(req);
      return bookAppointment(id, body.setupAppointmentAt, ctx);
    }
  );

  app.post("/businesses/:id/setup", { preHandler: requireAdmin("setup:complete") }, async (req) => {
    const { id } = req.params as { id: string };
    const body = requireFields(req.body, [
      "ownerEmail",
      "ownerFullName",
      "tempPassword",
      "businessType",
    ]);
    const ctx = adminOf(req);
    const result = await completeSetup(
      id,
      {
        ownerEmail: body.ownerEmail,
        ownerFullName: body.ownerFullName,
        tempPassword: body.tempPassword,
        businessType: body.businessType,
        tierId: body.tierId,
        storeName: body.storeName,
        language: body.language,
      },
      ctx
    );
    // Returned once so the technician can hand the temporary password to the
    // owner — it is never stored by the portal.
    return {
      ...result,
      ownerEmail: result.ownerEmail,
      tempPassword: body.tempPassword,
    };
  });
}

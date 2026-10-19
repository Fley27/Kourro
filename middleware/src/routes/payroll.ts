// Payroll endpoints — the device pings /close when its local clock saw the
// cycle expire; the engine decides and does the real work once.
import type { FastifyInstance } from "fastify";
import { isMockMode } from "../index.js";
import { requireAuth } from "../auth.js";
import { closeExpiredPeriods } from "../payroll.js";

export default async function payrollRoutes(app: FastifyInstance) {
  app.post("/close", async (req, reply) => {
    if (isMockMode) return { ok: true, closed: 0, mock: true };
    const auth = await requireAuth(req, reply, { anyStore: true });
    if (!auth) return;
    const { closed } = await closeExpiredPeriods(auth.organizationId ?? null, req.log);
    return { ok: true, closed };
  });
}

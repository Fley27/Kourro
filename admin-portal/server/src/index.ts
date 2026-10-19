import Fastify from "fastify";
import cors from "@fastify/cors";
import { env, assertEnv } from "./env.js";
import { HttpError } from "./errors.js";
import { camelize } from "./serialize.js";
import { runBillingCycle } from "./services/billing.js";
import { authRoutes } from "./routes/authRoutes.js";
import { dashboardRoutes } from "./routes/dashboardRoutes.js";
import { businessRoutes } from "./routes/businessRoutes.js";
import { seatRoutes } from "./routes/seatRoutes.js";
import { subscriptionRoutes } from "./routes/subscriptionRoutes.js";
import { tierRoutes } from "./routes/tierRoutes.js";
import { adminRoutes } from "./routes/adminRoutes.js";
import { logRoutes } from "./routes/logRoutes.js";

async function main() {
  const missing = assertEnv();
  if (missing.length > 0) {
    console.error(`Missing environment variables: ${missing.join(", ")}`);
    console.error("Copy .env.example to .env and fill in the values.");
    process.exit(1);
  }

  const app = Fastify({ logger: false, bodyLimit: 1_048_576 });

  // snake_case rows out, camelCase JSON in.
  app.setReplySerializer((payload) => JSON.stringify(camelize(payload)));

  // Tolerate empty JSON bodies (POSTs without a payload).
  app.addContentTypeParser("application/json", { parseAs: "string" }, (_req, body, done) => {
    const raw = typeof body === "string" ? body.trim() : "";
    if (raw === "") return done(null, {});
    try {
      done(null, JSON.parse(raw));
    } catch (err) {
      done(err as Error, undefined);
    }
  });

  await app.register(cors, { origin: true });

  app.setErrorHandler((error, _req, reply) => {
    if (error instanceof HttpError) {
      reply.status(error.status).send({ error: error.message, code: error.code });
      return;
    }
    const status = (error as any).statusCode;
    if (typeof status === "number" && status >= 400 && status < 500) {
      reply.status(status).send({ error: error.message, code: "bad_request" });
      return;
    }
    console.error(error);
    reply.status(500).send({ error: "Internal server error.", code: "internal" });
  });

  app.get("/api/health", async () => ({ ok: true, service: "admin-portal" }));

  await app.register(
    async (api) => {
      await api.register(authRoutes);
      await api.register(dashboardRoutes);
      await api.register(businessRoutes);
      await api.register(seatRoutes);
      await api.register(subscriptionRoutes);
      await api.register(tierRoutes);
      await api.register(adminRoutes);
      await api.register(logRoutes);
    },
    { prefix: "/api" }
  );

  await app.listen({ port: env.PORT, host: "0.0.0.0" });
  console.log(`Admin API listening on http://localhost:${env.PORT}`);

  // Billing scheduler: renewals → expiry → reactivation.
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const result = await runBillingCycle();
      if (result.renewed || result.expired || result.reactivated) {
        console.log("Billing cycle:", result);
      }
    } catch (err) {
      console.error("Billing cycle failed:", err instanceof Error ? err.message : err);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(tick, env.BILLING_JOB_INTERVAL_MS);
  timer.unref?.();
  setTimeout(tick, 15_000).unref?.();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

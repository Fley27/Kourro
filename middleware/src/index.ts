import Fastify from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import Redis from "ioredis";
import syncRoutes from "./routes/sync.js";
import salesRoutes from "./routes/sales.js";
import productsRoutes from "./routes/products.js";
import supplierCostRoutes from "./routes/supplier-costs.js";
import customersRoutes from "./routes/customers.js";
import analyticsRoutes from "./routes/analytics.js";

dotenv.config();

const PORT = Number(process.env.PORT ?? 4000);
const SUPABASE_URL = process.env.SUPABASE_URL ?? "";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";

const hasSupabase = Boolean(SUPABASE_URL && SUPABASE_KEY && !SUPABASE_URL.includes("localhost"));
export const supabase = createClient(
  SUPABASE_URL || "https://mock.supabase.co",
  SUPABASE_KEY || "mock-key",
  { auth: { persistSession: false } }
);
export const isMockMode = !hasSupabase;
if (isMockMode) console.log("[middleware] Running in MOCK mode (no Supabase) — API returns sample data. Set SUPABASE_URL to enable real DB.");

export const redis = new Redis(REDIS_URL, {
  lazyConnect: true,
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  enableOfflineQueue: false,
  retryStrategy: () => null,
});
redis.on("error", () => {}); // silent in mock mode
redis.connect().catch(() => console.log("[redis] mock mode — caching disabled"));

const app = Fastify({ logger: true });

await app.register(cors, { origin: true });
await app.register(websocket);

app.get("/health", async () => ({ status: "ok", time: new Date().toISOString() }));

await app.register(syncRoutes, { prefix: "/api/sync" });
await app.register(salesRoutes, { prefix: "/api/sales" });
await app.register(productsRoutes, { prefix: "/api/products" });
await app.register(supplierCostRoutes, { prefix: "/api/supplier-costs" });
await app.register(customersRoutes, { prefix: "/api/customers" });
await app.register(analyticsRoutes, { prefix: "/api/analytics" });

// LAN P2P relay via WebSocket — devices on same store WiFi sync peer-to-peer through middleware when online,
// but also usable as local hub when middleware runs on-store (e.g. Raspberry Pi / main register)
app.register(async function lanHub(fastify) {
  fastify.get("/lan", { websocket: true }, (socket, req) => {
    const storeId = (req.query as any)?.store_id ?? "unknown";
    const deviceId = (req.query as any)?.device_id ?? "anon";
    console.log(`[LAN] ${deviceId} joined store ${storeId}`);
    socket.on("message", (msg: Buffer) => {
      // broadcast to all peers in same store (simple pub via redis if available)
      // For now echo/broadcast to all connected sockets in this process
      // In production, use redis pub/sub to fan out across instances
      const text = msg.toString();
      // @ts-ignore
      for (const client of fastify.websocketServer.clients) {
        if (client !== socket && client.readyState === 1) client.send(text);
      }
    });
  });
});

app.listen({ port: PORT, host: "0.0.0.0" }).then(() => {
  console.log(`Middleware listening on http://localhost:${PORT}`);
});

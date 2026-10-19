import type { FastifyInstance } from "fastify";
import { adminOf, requireAdmin, requireAnyAdmin } from "../auth.js";
import { sql } from "../db.js";
import { badRequest, conflict, notFound, requireFields } from "../errors.js";
import { logActivity } from "../services/activity.js";
import { notifyTeam } from "../services/notify.js";

const ALLOWED_INTERVALS = new Set(["monthly", "yearly"]);

function cleanTierInput(body: Record<string, any>, partial: boolean) {
  const out: Record<string, any> = {};
  const put = (key: string, value: any) => {
    out[key] = value;
  };

  if (!partial || body.code !== undefined) {
    const code = String(body.code ?? "").trim().toLowerCase();
    if (!/^[a-z0-9_-]{2,32}$/.test(code)) {
      throw badRequest("code must be 2-32 chars: lowercase letters, numbers, - or _.");
    }
    put("code", code);
  }
  if (!partial || body.name !== undefined) {
    const name = String(body.name ?? "").trim();
    if (name.length < 2) throw badRequest("name is required.");
    put("name", name);
  }
  if (body.description !== undefined) put("description", body.description ?? null);
  if (body.priceCents !== undefined) {
    const price = Math.round(Number(body.priceCents));
    if (!Number.isFinite(price) || price < 0) throw badRequest("priceCents must be >= 0.");
    put("price_cents", price);
  }
  if (body.currency !== undefined) put("currency", String(body.currency).trim().toUpperCase());
  if (body.interval !== undefined) {
    if (!ALLOWED_INTERVALS.has(body.interval)) throw badRequest("interval must be monthly or yearly.");
    put("interval", body.interval);
  }
  if (body.baseSeats !== undefined) {
    const seats = Number(body.baseSeats);
    if (!Number.isInteger(seats) || seats < 0) throw badRequest("baseSeats must be >= 0.");
    put("base_seats", seats);
  }
  if (body.seatPriceCents !== undefined) {
    const price = Math.round(Number(body.seatPriceCents));
    if (!Number.isFinite(price) || price < 0) throw badRequest("seatPriceCents must be >= 0.");
    put("seat_price_cents", price);
  }
  if (body.maxStores !== undefined) {
    const max = body.maxStores === null ? null : Number(body.maxStores);
    if (max !== null && (!Number.isInteger(max) || max < 1)) {
      throw badRequest("maxStores must be a positive integer or null.");
    }
    put("max_stores", max);
  }
  if (body.features !== undefined) {
    if (typeof body.features !== "object" || body.features === null || Array.isArray(body.features)) {
      throw badRequest("features must be an object.");
    }
    put("features", JSON.stringify(body.features));
  }
  if (body.isActive !== undefined) put("is_active", Boolean(body.isActive));
  if (body.sortOrder !== undefined) put("sort_order", Math.round(Number(body.sortOrder)) || 0);

  return out;
}

function mapTier(row: any) {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description,
    priceCents: Number(row.price_cents),
    currency: row.currency,
    interval: row.interval,
    baseSeats: Number(row.base_seats),
    seatPriceCents: Number(row.seat_price_cents),
    maxStores: row.max_stores === null ? null : Number(row.max_stores),
    features: typeof row.features === "string" ? JSON.parse(row.features) : row.features,
    isActive: row.is_active,
    sortOrder: Number(row.sort_order),
    businessCount: Number(row.business_count ?? 0),
    subscriptionCount: Number(row.subscription_count ?? 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const TIER_SELECT = `
  select t.*,
         (select count(*) from adm_businesses b where b.tier_id = t.id)::int as business_count,
         (select count(*) from adm_subscriptions s where s.tier_id = t.id)::int as subscription_count
  from adm_tiers t`;

export async function tierRoutes(app: FastifyInstance) {
  app.get("/tiers", { preHandler: requireAnyAdmin() }, async () => {
    const rows = await sql.unsafe(`${TIER_SELECT} order by t.sort_order, t.created_at`);
    return { items: rows.map(mapTier) };
  });

  // Super admin only: the platform's tiers are configuration, not sales data.
  app.post("/tiers", { preHandler: requireAdmin("tiers:manage") }, async (req, reply) => {
    const body = requireFields(req.body, ["code", "name"]);
    const input = cleanTierInput(body, false);
    const ctx = adminOf(req);

    const clash = await sql`select id from adm_tiers where code = ${input.code}`;
    if (clash.length > 0) throw conflict("A tier with that code already exists.", "code_taken");

    const rows = await sql`
      insert into adm_tiers (code, name, description, price_cents, currency, interval,
                             base_seats, seat_price_cents, max_stores, features, is_active, sort_order)
      values (${input.code}, ${input.name}, ${input.description ?? null}, ${input.price_cents ?? 0},
              ${input.currency ?? 'HTG'}, ${input.interval ?? 'monthly'}, ${input.base_seats ?? 1},
              ${input.seat_price_cents ?? 0}, ${input.max_stores ?? null},
              ${input.features ?? '{}'}::jsonb, ${input.is_active ?? true}, ${input.sort_order ?? 0})
      returning *`;
    const tier = mapTier(rows[0]);

    await logActivity({
      action: "tier.created",
      summary: `${ctx.fullName} created tier "${tier.name}" (${tier.code})`,
      actorType: "admin",
      actorLabel: `${ctx.fullName} (${ctx.email})`,
      adminId: ctx.adminId,
      metadata: { tierId: tier.id, code: tier.code, priceCents: tier.priceCents },
    });
    await notifyTeam({
      type: "tier_created",
      title: "New subscription tier",
      body: `${ctx.fullName} created the "${tier.name}" tier.`,
      link: "/tiers",
      excludeAdminId: ctx.adminId,
    });

    reply.status(201);
    return tier;
  });

  app.patch("/tiers/:id", { preHandler: requireAdmin("tiers:manage") }, async (req) => {
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as Record<string, any>;
    const input = cleanTierInput(body, true);
    const ctx = adminOf(req);
    if (Object.keys(input).length === 0) throw badRequest("Nothing to update.");

    const sets = Object.keys(input)
      .map((key, index) => `${key} = $${index + 2}${key === "features" ? "::jsonb" : ""}`)
      .join(", ");
    const params = [id, ...Object.values(input)];
    const rows = await sql.unsafe(
      `update adm_tiers set ${sets} where id = $1 returning *`,
      params
    );
    if (rows.length === 0) throw notFound("Tier not found.");
    const tier = mapTier(rows[0]);

    await logActivity({
      action: "tier.updated",
      summary: `${ctx.fullName} updated tier "${tier.name}"`,
      actorType: "admin",
      actorLabel: `${ctx.fullName} (${ctx.email})`,
      adminId: ctx.adminId,
      metadata: { tierId: tier.id, changed: Object.keys(input) },
    });
    await notifyTeam({
      type: "tier_updated",
      title: "Tier updated",
      body: `${ctx.fullName} updated the "${tier.name}" tier. Active subscriptions keep their snapshotted prices.`,
      link: "/tiers",
      excludeAdminId: ctx.adminId,
    });
    return tier;
  });

  app.delete("/tiers/:id", { preHandler: requireAdmin("tiers:manage") }, async (req) => {
    const { id } = req.params as { id: string };
    const ctx = adminOf(req);
    const rows = await sql`select * from adm_tiers where id = ${id}`;
    if (rows.length === 0) throw notFound("Tier not found.");
    const tier = mapTier(rows[0]);

    // In use → deactivate instead of deleting, so history stays intact.
    if (tier.subscriptionCount > 0 || tier.businessCount > 0) {
      await sql`update adm_tiers set is_active = false where id = ${id}`;
      await logActivity({
        action: "tier.deactivated",
        summary: `${ctx.fullName} deactivated tier "${tier.name}" (still in use by ${tier.subscriptionCount} subscription(s))`,
        actorType: "admin",
        actorLabel: `${ctx.fullName} (${ctx.email})`,
        adminId: ctx.adminId,
        metadata: { tierId: id },
      });
      await notifyTeam({
        type: "tier_deactivated",
        title: "Tier deactivated",
        body: `${ctx.fullName} deactivated "${tier.name}" — it stays visible for existing subscriptions.`,
        link: "/tiers",
        excludeAdminId: ctx.adminId,
      });
      return { deactivated: true, tier: { ...tier, isActive: false } };
    }

    await sql`delete from adm_tiers where id = ${id}`;
    await logActivity({
      action: "tier.deleted",
      summary: `${ctx.fullName} deleted tier "${tier.name}"`,
      actorType: "admin",
      actorLabel: `${ctx.fullName} (${ctx.email})`,
      adminId: ctx.adminId,
      metadata: { tierId: id, code: tier.code },
    });
    await notifyTeam({
      type: "tier_deleted",
      title: "Tier deleted",
      body: `${ctx.fullName} deleted the unused "${tier.name}" tier.`,
      link: "/tiers",
      excludeAdminId: ctx.adminId,
    });
    return { deleted: true };
  });
}

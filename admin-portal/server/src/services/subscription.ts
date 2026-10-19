import { sql } from "../db.js";
import { env } from "../env.js";
import { badRequest, conflict, notFound } from "../errors.js";
import type { AdminCtx } from "../auth.js";
import { logActivity } from "./activity.js";
import { notifyTeam } from "./notify.js";
import { createInvoice, getBalance, settleBusiness } from "./invoices.js";
import { dateOnly, formatCents, prorateCents } from "./money.js";
import { syncPortalSubscription } from "./ownerAccount.js";

function addIntervalSql(interval: string): string {
  return interval === "yearly" ? "1 year" : "1 month";
}

export type RenewResult = {
  renewsAt: Date;
  previousRenewsAt: Date;
  periodStart: Date;
  amountCents: number;
  invoiceNumber: string | null;
  balanceCents: number;
};

/**
 * Manual renewal (admin-triggered). Runs the same lump-sum renewal the
 * scheduler would, but immediately and on demand:
 *
 *   - periodStart = max(renews_at, now): an overdue subscription restarts from
 *     today; an early renewal pre-pays the period after the current one and
 *     does NOT touch current_period_start (the clock stays where it is).
 *   - periodEnd   = periodStart + one interval; renews_at moves there.
 *   - one invoice: tier price + every extra seat, kind = renewal, due at
 *     period end + grace (same as the scheduler).
 *
 * Guards: the subscription must be active (expired ones reactivate through
 * payment), and there must be no open renewal invoice already — otherwise a
 * double renew would bill the same period twice.
 */
export async function renewSubscription(opts: {
  businessId: string;
  admin: AdminCtx;
}): Promise<RenewResult> {
  const { businessId, admin } = opts;

  return sql.begin(async (tx) => {
    const rows = await tx`
      select s.*, b.name as business_name, b.organization_id, t.name as tier_name
      from adm_subscriptions s
      join adm_businesses b on b.id = s.business_id
      join adm_tiers t on t.id = s.tier_id
      where s.business_id = ${businessId}
      for update of s`;
    if (rows.length === 0) throw notFound("This business has no subscription yet.");
    const sub = rows[0];
    if (sub.status !== "active") {
      throw conflict(
        "Only an active subscription can be renewed. Record a payment to clear the balance — the subscription reactivates automatically.",
        "subscription_not_active"
      );
    }
    const openRenewal = await tx`
      select id from adm_invoices
      where subscription_id = ${sub.id} and kind = 'renewal' and status = 'open'
      limit 1`;
    if (openRenewal.length > 0) {
      throw conflict(
        "A renewal invoice is already open for this subscription — record a payment against it instead of renewing again.",
        "renewal_invoice_open"
      );
    }

    const now = new Date();
    const renewsAt = new Date(sub.renews_at);
    const periodStart = new Date(Math.max(renewsAt.getTime(), now.getTime()));
    const adv = await tx`
      select ${periodStart}::timestamptz + ${addIntervalSql(sub.interval)}::interval as next_renews_at`;
    const nextRenewsAt: Date = adv[0].next_renews_at;

    const amountCents =
      Number(sub.tier_price_cents) + Number(sub.extra_seats) * Number(sub.seat_price_cents);

    let invoiceNumber: string | null = null;
    if (amountCents > 0) {
      const dueAt = new Date(nextRenewsAt.getTime() + env.RENEWAL_GRACE_DAYS * 86_400_000);
      const invoice = await createInvoice(tx, {
        businessId,
        subscriptionId: sub.id,
        kind: "renewal",
        description: `Renewal — ${sub.tier_name} + ${sub.extra_seats} extra seats`,
        amountCents,
        periodStart,
        periodEnd: nextRenewsAt,
        dueAt,
        createdBy: admin.adminId,
      });
      invoiceNumber = invoice.number;
    }

    const updated = await tx`
      update adm_subscriptions
      set renews_at = ${nextRenewsAt},
          current_period_start = case
            when renews_at <= now() then ${periodStart}
            else current_period_start
          end
      where id = ${sub.id}
      returning renews_at, current_period_start`;

    // Keep the portal's subscriptions row (the write-gate's source of truth)
    // on the same window as the admin row.
    await syncPortalSubscription(tx, {
      organizationId: sub.organization_id,
      status: "active",
      renewsAt: updated[0].renews_at,
    });

    // Spread any existing credit across the fresh invoice immediately.
    await settleBusiness(tx, businessId);
    const balance = await getBalance(businessId, tx);

    await logActivity(
      {
        action: "subscription.renewed",
        summary: `${admin.fullName} renewed ${sub.business_name} — new period ends ${dateOnly(updated[0].renews_at)} (${formatCents(amountCents, sub.currency)} invoiced)`,
        actorType: "admin",
        actorLabel: `${admin.fullName} (${admin.email})`,
        adminId: admin.adminId,
        businessId,
        metadata: {
          amountCents,
          previousRenewsAt: sub.renews_at,
          renewsAt: updated[0].renews_at,
          invoiceNumber,
        },
      },
      tx
    );

    await notifyTeam(
      {
        type: "subscription_renewed",
        title: "Subscription renewed",
        body: `${admin.fullName} renewed ${sub.business_name} — new period ends ${dateOnly(updated[0].renews_at)} (${formatCents(amountCents, sub.currency)} invoiced).`,
        businessId,
        link: `/businesses/${businessId}`,
        excludeAdminId: admin.adminId,
      },
      tx
    );

    return {
      renewsAt: updated[0].renews_at,
      previousRenewsAt: sub.renews_at,
      periodStart,
      amountCents,
      invoiceNumber,
      balanceCents: balance.balanceCents,
    };
  });
}

export type TierChangeResult = {
  changed: boolean;
  tierId: string;
  tierName: string;
  previousTierName: string;
  tierPriceCents: number;
  upgradeCents: number;
  baseSeats: number;
  totalSeats: number;
  paidSeats: number;
  renewsAt: Date;
  balanceCents: number;
};

/**
 * Tier change (upgrade). Two callers: an admin on the customer's behalf, or
 * the business owner self-serving from the customer portal — both flow through
 * here with identical money semantics:
 *
 *   - the price difference is prorated for the days left in the current period
 *     and invoiced immediately (kind = tier_upgrade); the renewal date never
 *     moves, and at renewal everything bills as one lump sum at the new price.
 *   - the subscription snapshot (tier, tier price, seat price, included seats)
 *     and the business's tier pointer switch to the new tier right away.
 *   - only upgrades are supported: a same-or-cheaper tier would need a credit
 *     we cannot issue through this flow, so it returns
 *     `400 tier_downgrade_not_supported`.
 *
 * Same-tier calls are an idempotent no-op (200, nothing charged/logged).
 */
export async function changeTier(opts: {
  businessId: string;
  tierId: string;
  source: "admin" | "self_service";
  admin?: AdminCtx;
  ownerEmail?: string;
}): Promise<TierChangeResult> {
  const { businessId, source, tierId } = opts;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tierId)) {
    throw badRequest("That tier is not available.", "tier_not_available");
  }

  return sql.begin(async (tx) => {
    const rows = await tx`
      select s.*, b.name as business_name, b.owner_email, t.name as current_tier_name
      from adm_subscriptions s
      join adm_businesses b on b.id = s.business_id
      join adm_tiers t on t.id = s.tier_id
      where s.business_id = ${businessId}
      for update of s`;
    if (rows.length === 0) throw notFound("This business has no subscription yet.");
    const sub = rows[0];

    const tiers = await tx`
      select * from adm_tiers where id = ${tierId} and is_active = true`;
    if (tiers.length === 0) throw badRequest("That tier is not available.", "tier_not_available");
    const tier = tiers[0];

    if (sub.status !== "active") {
      throw conflict(
        "The tier can only be changed while the subscription is active.",
        "subscription_not_active"
      );
    }

    const balance0 = () => getBalance(businessId, tx);

    if (tier.id === sub.tier_id) {
      // Idempotent no-op: same tier requested again.
      const balance = await balance0();
      return {
        changed: false,
        tierId: tier.id,
        tierName: tier.name,
        previousTierName: sub.current_tier_name,
        tierPriceCents: Number(sub.tier_price_cents),
        upgradeCents: 0,
        baseSeats: Number(sub.base_seats),
        totalSeats: Number(sub.base_seats) + Number(sub.extra_seats),
        paidSeats: Number(sub.extra_seats),
        renewsAt: new Date(sub.renews_at),
        balanceCents: balance.balanceCents,
      };
    }

    if (tier.interval !== sub.interval) {
      throw badRequest(
        `That tier bills ${tier.interval} while this subscription bills ${sub.interval}.`,
        "interval_mismatch"
      );
    }
    if (tier.currency !== sub.currency) {
      throw badRequest("That tier uses a different currency.", "currency_mismatch");
    }
    const newPrice = Number(tier.price_cents);
    const oldPrice = Number(sub.tier_price_cents);
    if (newPrice <= oldPrice) {
      throw badRequest(
        `Only upgrades to a more expensive tier are supported through self-service (${sub.current_tier_name} → ${tier.name} is not an upgrade). Contact support to change plan downwards.`,
        "tier_downgrade_not_supported"
      );
    }

    const now = new Date();
    const upgradeCents = prorateCents({
      amountCents: newPrice - oldPrice,
      periodStart: new Date(sub.current_period_start),
      renewsAt: new Date(sub.renews_at),
      now,
    });

    const invoice = await createInvoice(tx, {
      businessId,
      subscriptionId: sub.id,
      kind: "tier_upgrade",
      description: `Tier upgrade — ${sub.current_tier_name} → ${tier.name}, prorated to ${dateOnly(sub.renews_at)}`,
      amountCents: upgradeCents,
      periodStart: now,
      periodEnd: new Date(sub.renews_at),
      dueAt: now,
      createdBy: opts.admin?.adminId ?? null,
    });

    const updated = await tx`
      update adm_subscriptions
      set tier_id = ${tier.id},
          tier_price_cents = ${tier.price_cents},
          seat_price_cents = ${tier.seat_price_cents},
          base_seats = ${tier.base_seats}
      where id = ${sub.id}
      returning *`;
    const next = updated[0];

    // The business row carries the tier pointer used by list/detail displays.
    await tx`
      update adm_businesses set tier_id = ${tier.id} where id = ${businessId}`;

    // Apply any credit on file against the new proration invoice right away.
    await settleBusiness(tx, businessId);
    const balance = await balance0();

    const isSelfService = source === "self_service";
    const actorLabel = isSelfService
      ? `${opts.ownerEmail ?? sub.owner_email ?? "owner"} (owner)`
      : `${opts.admin!.fullName} (${opts.admin!.email})`;
    const amount = formatCents(upgradeCents, sub.currency);

    await logActivity(
      {
        action: isSelfService ? "subscription.upgraded.self_service" : "subscription.upgraded",
        summary: isSelfService
          ? `${sub.business_name} upgraded from ${sub.current_tier_name} to ${tier.name} on their own (${amount} prorated)`
          : `${opts.admin!.fullName} upgraded ${sub.business_name} from ${sub.current_tier_name} to ${tier.name} (${amount} prorated)`,
        actorType: isSelfService ? "owner" : "admin",
        actorLabel,
        adminId: opts.admin?.adminId ?? null,
        businessId,
        metadata: {
          previousTierId: sub.tier_id,
          previousTierName: sub.current_tier_name,
          tierId: tier.id,
          tierName: tier.name,
          upgradeCents,
          invoiceNumber: invoice.number,
          source,
        },
      },
      tx
    );

    await notifyTeam(
      {
        type: "subscription_upgraded",
        title: isSelfService ? "Customer upgraded their plan (self-service)" : "Subscription upgraded",
        body: isSelfService
          ? `${sub.business_name} upgraded from ${sub.current_tier_name} to ${tier.name} without approval — ${amount} prorated charge created. Review the balance when you can.`
          : `${opts.admin!.fullName} upgraded ${sub.business_name} from ${sub.current_tier_name} to ${tier.name} — ${amount} prorated charge created.`,
        businessId,
        link: `/businesses/${businessId}`,
        excludeAdminId: opts.admin?.adminId ?? null,
      },
      tx
    );

    return {
      changed: true,
      tierId: tier.id,
      tierName: tier.name,
      previousTierName: sub.current_tier_name,
      tierPriceCents: newPrice,
      upgradeCents,
      baseSeats: Number(next.base_seats),
      totalSeats: Number(next.base_seats) + Number(next.extra_seats),
      paidSeats: Number(next.extra_seats),
      renewsAt: new Date(next.renews_at),
      balanceCents: balance.balanceCents,
    };
  });
}

import { sql } from "../db.js";
import { badRequest, conflict, notFound } from "../errors.js";
import type { AdminCtx } from "../auth.js";
import { logActivity } from "./activity.js";
import { notifyTeam } from "./notify.js";
import { createInvoice, getBalance, settleBusiness } from "./invoices.js";
import { dateOnly, formatCents, pluralize, prorateSeatCents } from "./money.js";

export type AddSeatsResult = {
  seatsAdded: number;
  proratedCents: number;
  totalSeats: number;
  paidSeats: number;
  renewsAt: Date;
  balanceCents: number;
};

/**
 * Adds paid seats to a subscription.
 *
 * Mid-cycle additions are prorated for the days left in the current period so
 * the seat catches up to the existing renewal date — the renewal date never
 * moves, and at renewal everything bills as one lump sum.
 *
 * Two callers:
 *   - technician / super admin adding on a customer's behalf (`admin` source,
 *     mode "add": `seats` is how many to add)
 *   - the business owner self-serving from the customer portal
 *     (`self_service` source, mode "total": `seats` is the desired total seat
 *     count — idempotent) — no approval gate, goes through immediately,
 *     and always notifies the whole admin team.
 */
export async function addSeats(opts: {
  businessId: string;
  seats: number;
  source: "admin" | "self_service";
  mode?: "add" | "total";
  admin?: AdminCtx;
  ownerEmail?: string;
}): Promise<AddSeatsResult> {
  const { businessId, source } = opts;
  const mode = opts.mode ?? "add";
  if (!Number.isInteger(opts.seats) || opts.seats < 1) {
    throw badRequest("Seats must be a positive whole number.", "invalid_seats");
  }

  return sql.begin(async (tx) => {
    const rows = await tx`
      select s.*, b.name as business_name, b.owner_email
      from adm_subscriptions s
      join adm_businesses b on b.id = s.business_id
      where s.business_id = ${businessId}
      for update of s`;
    if (rows.length === 0) throw notFound("This business has no subscription yet.");
    const sub = rows[0];
    if (sub.status !== "active") {
      throw conflict("Seats can only be added while the subscription is active.", "subscription_not_active");
    }

    const currentSeats = Number(sub.base_seats) + Number(sub.extra_seats);
    let seats: number;
    if (mode === "total") {
      if (opts.seats === currentSeats) {
        const balance = await getBalance(businessId, tx);
        return {
          seatsAdded: 0,
          proratedCents: 0,
          totalSeats: currentSeats,
          paidSeats: Number(sub.extra_seats),
          renewsAt: new Date(sub.renews_at),
          balanceCents: balance.balanceCents,
        };
      }
      if (opts.seats < currentSeats) {
        throw badRequest(
          `Seat count cannot be reduced (currently ${currentSeats}); contact support to lower seats.`,
          "seats_reduction_not_supported"
        );
      }
      seats = opts.seats - currentSeats;
    } else {
      seats = opts.seats;
    }
    if (seats > 50) {
      throw badRequest("Seats must be a whole number between 1 and 50.", "invalid_seats");
    }

    const now = new Date();
    const proratedCents = prorateSeatCents({
      seatPriceCents: Number(sub.seat_price_cents),
      seats,
      periodStart: new Date(sub.current_period_start),
      renewsAt: new Date(sub.renews_at),
      now,
    });

    if (proratedCents > 0) {
      await createInvoice(tx, {
        businessId,
        subscriptionId: sub.id,
        kind: "seat_proration",
        description: `${seats} extra ${pluralize(seats, "seat", "seats")} — prorated to ${dateOnly(sub.renews_at)}`,
        amountCents: proratedCents,
        dueAt: now,
        createdBy: opts.admin?.adminId ?? null,
      });
    }

    const updated = await tx`
      update adm_subscriptions
      set extra_seats = extra_seats + ${seats}
      where id = ${sub.id}
      returning *`;
    const next = updated[0];

    // Apply any credit on file against the new proration invoice right away.
    await settleBusiness(tx, businessId);
    const balance = await getBalance(businessId, tx);

    const isSelfService = source === "self_service";
    const actorLabel = isSelfService
      ? `${opts.ownerEmail ?? sub.owner_email ?? "owner"} (owner)`
      : `${opts.admin!.fullName} (${opts.admin!.email})`;
    const amount = formatCents(proratedCents, sub.currency);

    await logActivity(
      {
        action: isSelfService ? "seats.added.self_service" : "seats.added.by_admin",
        summary: isSelfService
          ? `${sub.business_name} added ${seats} ${pluralize(seats, "seat", "seats")} on their own (${amount} prorated)`
          : `${opts.admin!.fullName} added ${seats} ${pluralize(seats, "seat", "seats")} to ${sub.business_name} (${amount} prorated)`,
        actorType: isSelfService ? "owner" : "admin",
        actorLabel,
        adminId: opts.admin?.adminId ?? null,
        businessId,
        metadata: {
          seats,
          proratedCents,
          paidSeats: Number(next.extra_seats),
          renewsAt: next.renews_at,
          source,
        },
      },
      tx
    );

    await notifyTeam(
      {
        type: "seats_added",
        title: isSelfService ? "Customer added seats (self-service)" : "Seats added by your team",
        body: isSelfService
          ? `${sub.business_name} added ${seats} ${pluralize(seats, "seat", "seats")} without approval — ${amount} prorated charge created. Review the balance when you can.`
          : `${opts.admin!.fullName} added ${seats} ${pluralize(seats, "seat", "seats")} to ${sub.business_name} — ${amount} prorated charge created.`,
        businessId,
        link: `/businesses/${businessId}`,
        excludeAdminId: opts.admin?.adminId ?? null,
      },
      tx
    );

    return {
      seatsAdded: seats,
      proratedCents,
      totalSeats: Number(next.base_seats) + Number(next.extra_seats),
      paidSeats: Number(next.extra_seats),
      renewsAt: next.renews_at,
      balanceCents: balance.balanceCents,
    };
  });
}

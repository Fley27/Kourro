import { sql, type Db } from "../db.js";
import { env } from "../env.js";
import { logActivity } from "./activity.js";
import { notifyTeam } from "./notify.js";
import { createInvoice, settleBusiness } from "./invoices.js";
import { syncPortalSubscription } from "./ownerAccount.js";

/**
 * The billing clock starts at setup completion — never at payment date.
 * This job runs periodically and:
 *   1. renews due subscriptions (one lump-sum invoice: tier price + all seats),
 *   2. expires subscriptions whose renewal invoice is still open past grace,
 *   3. reactivates subscriptions that have been paid in full.
 */

export type BillingCycleResult = {
  renewed: number;
  expired: number;
  reactivated: number;
};

function addIntervalSql(interval: string): string {
  return interval === "yearly" ? "1 year" : "1 month";
}

export async function runBillingCycle(): Promise<BillingCycleResult> {
  const result: BillingCycleResult = { renewed: 0, expired: 0, reactivated: 0 };

  await sql.begin(async (tx) => {
    // ---- 1. renewals -------------------------------------------------
    const due = await tx`
      select s.id, s.business_id, s.tier_price_cents, s.extra_seats, s.seat_price_cents,
             s.renews_at, s.current_period_start, s.interval, s.currency,
             b.name as business_name, b.organization_id, t.name as tier_name
      from adm_subscriptions s
      join adm_businesses b on b.id = s.business_id
      join adm_tiers t on t.id = s.tier_id
      where s.status = 'active' and s.renews_at <= now()
      order by s.renews_at
      for update of s`;

    for (const sub of due) {
      const nextRows = await tx`
        select (${sub.renews_at})::timestamptz + ${addIntervalSql(sub.interval)}::interval as next_renews_at`;
      const nextRenewsAt: Date = nextRows[0].next_renews_at;

      const amountCents =
        Number(sub.tier_price_cents) + Number(sub.extra_seats) * Number(sub.seat_price_cents);

      if (amountCents > 0) {
        const dueAt = new Date(nextRenewsAt.getTime() + env.RENEWAL_GRACE_DAYS * 86_400_000);
        await createInvoice(tx, {
          businessId: sub.business_id,
          subscriptionId: sub.id,
          kind: "renewal",
          description: `Renewal — ${sub.tier_name} + ${sub.extra_seats} extra seats`,
          amountCents,
          periodStart: sub.renews_at,
          periodEnd: nextRenewsAt,
          dueAt,
        });
      }

      await tx`
        update adm_subscriptions
        set current_period_start = renews_at,
            renews_at = ${nextRenewsAt}
        where id = ${sub.id}`;

      // The write-gate reads the PORTAL subscriptions row — keep its window
      // moving with the admin one, or a renewed org stays read-only.
      await syncPortalSubscription(tx, {
        organizationId: sub.organization_id,
        status: "active",
        renewsAt: nextRenewsAt,
      });

      // Spread any existing credit across the fresh invoice immediately.
      await settleBusiness(tx, sub.business_id);

      await logActivity(
        {
          action: "billing.renewed",
          summary: `Subscription renewed for ${sub.business_name} — new period ends ${nextRenewsAt.toISOString().slice(0, 10)}`,
          actorType: "system",
          actorLabel: "Billing scheduler",
          businessId: sub.business_id,
          metadata: { amountCents, renewsAt: nextRenewsAt.toISOString() },
        },
        tx
      );
      result.renewed += 1;
    }

    // ---- 2. expiry: renewal invoice still open past the grace period ---
    const expired = await tx`
      update adm_subscriptions s
      set status = 'expired'
      from adm_businesses b
      where b.id = s.business_id
        and s.status = 'active'
        and exists (
          select 1 from adm_invoices i
          where i.subscription_id = s.id
            and i.status = 'open'
            and i.kind = 'renewal'
            and i.due_at is not null
            and i.due_at < now())
      returning s.id, s.business_id, b.organization_id`;

    for (const sub of expired) {
      // Portal row goes 'paused' → every register flips read-only.
      await syncPortalSubscription(tx, {
        organizationId: sub.organization_id,
        status: "expired",
      });
      const business = await tx`select name from adm_businesses where id = ${sub.business_id}`;
      const name = business[0]?.name ?? "Customer";
      await logActivity(
        {
          action: "subscription.expired",
          summary: `Subscription expired for ${name} — renewal invoice unpaid after ${env.RENEWAL_GRACE_DAYS}-day grace period`,
          actorType: "system",
          actorLabel: "Billing scheduler",
          businessId: sub.business_id,
        },
        tx
      );
      await notifyTeam(
        {
          type: "subscription_expired",
          title: "Subscription expired",
          body: `${name} went past the renewal grace period without paying.`,
          businessId: sub.business_id,
          link: `/businesses/${sub.business_id}`,
        },
        tx
      );
      result.expired += 1;
    }

    // ---- 3. reactivation once everything is paid ---------------------
    const reactivated = await tx`
      update adm_subscriptions s
      set status = 'active',
          current_period_start = now(),
          renews_at = now() + case when s.interval = 'monthly' then interval '1 month' else interval '1 year' end
      from adm_businesses b
      where b.id = s.business_id
        and s.status = 'expired'
        and not exists (
          select 1 from adm_invoices i
          where i.business_id = s.business_id and i.status = 'open')
      returning s.id, s.business_id, b.organization_id, s.renews_at`;

    for (const sub of reactivated) {
      // Paid → portal row back to active with the fresh window.
      await syncPortalSubscription(tx, {
        organizationId: sub.organization_id,
        status: "active",
        renewsAt: sub.renews_at,
      });
      const business = await tx`select name from adm_businesses where id = ${sub.business_id}`;
      const name = business[0]?.name ?? "Customer";
      await logActivity(
        {
          action: "subscription.reactivated",
          summary: `Subscription reactivated for ${name} — balance settled, next renewal ${sub.renews_at.toISOString().slice(0, 10)}`,
          actorType: "system",
          actorLabel: "Billing scheduler",
          businessId: sub.business_id,
        },
        tx
      );
      await notifyTeam(
        {
          type: "subscription_reactivated",
          title: "Subscription reactivated",
          body: `${name} settled their balance and is active again.`,
          businessId: sub.business_id,
          link: `/businesses/${sub.business_id}`,
        },
        tx
      );
      result.reactivated += 1;
    }
  });

  return result;
}

/**
 * Fast path: reactivates a single subscription as soon as no open invoices
 * remain (called right after a payment settles).
 */
export async function reactivateIfSettled(businessId: string, db: Db = sql): Promise<boolean> {
  const rows = await db`
    update adm_subscriptions s
    set status = 'active',
        current_period_start = now(),
        renews_at = now() + case when s.interval = 'monthly' then interval '1 month' else interval '1 year' end
    from adm_businesses b
    where b.id = s.business_id
      and s.business_id = ${businessId}
      and s.status = 'expired'
      and not exists (
        select 1 from adm_invoices i
        where i.business_id = ${businessId} and i.status = 'open')
    returning s.id, s.renews_at, b.organization_id`;
  if (rows.length === 0) return false;

  await syncPortalSubscription(db, {
    organizationId: rows[0].organization_id,
    status: "active",
    renewsAt: rows[0].renews_at,
  });
  const business = await db`select name from adm_businesses where id = ${businessId}`;
  const name = business[0]?.name ?? "Customer";
  await logActivity(
    {
      action: "subscription.reactivated",
      summary: `Subscription reactivated for ${name} — balance settled, next renewal ${rows[0].renews_at.toISOString().slice(0, 10)}`,
      actorType: "system",
      actorLabel: "Billing engine",
      businessId,
    },
    db
  );
  await notifyTeam(
    {
      type: "subscription_reactivated",
      title: "Subscription reactivated",
      body: `${name} settled their balance and is active again.`,
      businessId,
      link: `/businesses/${businessId}`,
    },
    db
  );
  return true;
}

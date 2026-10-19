import type { FastifyInstance } from "fastify";
import { adminOf, requireAnyAdmin } from "../auth.js";
import { env } from "../env.js";
import { sql } from "../db.js";

export async function dashboardRoutes(app: FastifyInstance) {
  app.get("/dashboard", { preHandler: requireAnyAdmin() }, async (req) => {
    const ctx = adminOf(req);

    const [totals, balances, collected, appointments, activity, unread] = await Promise.all([
      sql`
        select
          count(*)::int as total,
          count(*) filter (where b.pipeline_status = 'prospect')::int as prospect,
          count(*) filter (where b.pipeline_status = 'paid')::int as paid,
          count(*) filter (where b.pipeline_status = 'setup_scheduled')::int as setup_scheduled,
          count(*) filter (where b.pipeline_status = 'setup_complete')::int as setup_complete,
          count(*) filter (where s.status = 'active')::int as active,
          count(*) filter (where s.status = 'expired')::int as expired,
          count(*) filter (
            where s.status = 'active'
              and s.renews_at <= now() + make_interval(days => ${env.RENEWING_SOON_DAYS})
          )::int as renewing_soon
        from adm_businesses b
        left join adm_subscriptions s on s.business_id = b.id`,
      sql`
        with per as (
          select b.id,
                 coalesce((select currency from adm_subscriptions where business_id = b.id), 'USD') as currency,
                 coalesce((select sum(i.amount_cents) from adm_invoices i
                           where i.business_id = b.id and i.status = 'open'), 0) as open_cents,
                 coalesce((select sum(p.amount_cents) from adm_payments p
                           where p.business_id = b.id), 0) as paid_cents,
                 coalesce((select sum(a.amount_cents) from adm_payment_applications a
                           join adm_payments p on p.id = a.payment_id
                           where p.business_id = b.id), 0) as applied_cents
          from adm_businesses b
        )
        select currency,
               coalesce(sum(case when open_cents - (paid_cents - applied_cents) > 0
                                 then open_cents - (paid_cents - applied_cents) else 0 end), 0)::bigint as owed,
               coalesce(sum(case when open_cents - (paid_cents - applied_cents) < 0
                                 then -(open_cents - (paid_cents - applied_cents)) else 0 end), 0)::bigint as credit
        from per
        group by currency`,
      sql`
        select currency, coalesce(sum(amount_cents), 0)::bigint as total
        from adm_payments
        where received_at >= date_trunc('month', now())
        group by currency`,
      sql`
        select id, name, setup_appointment_at, owner_email
        from adm_businesses
        where setup_appointment_at is not null
          and setup_appointment_at >= now()
          and pipeline_status <> 'setup_complete'
          and pipeline_status <> 'cancelled'
        order by setup_appointment_at
        limit 6`,
      sql`
        select l.id, l.action, l.summary, l.actor_type, l.actor_label, l.business_id, l.created_at,
               b.name as business_name
        from adm_activity_log l
        left join adm_businesses b on b.id = l.business_id
        order by l.created_at desc
        limit 8`,
      sql`
        select count(*)::int as n from adm_notifications
        where admin_id = ${ctx.adminId} and read_at is null`,
    ]);

    // Dashboard KPIs report in USD; amounts held in other currencies are
    // converted for display only (stored rows keep their original currency).
    const FX_TO_USD: Record<string, number> = { USD: 1, HTG: 130 };
    const toUsd = (cents: number, currency: string) =>
      Math.round(cents / (FX_TO_USD[currency] ?? 1));

    return {
      totals: totals[0],
      money: {
        owedCents: balances.reduce((s, r) => s + toUsd(Number(r.owed), String(r.currency)), 0),
        creditCents: balances.reduce((s, r) => s + toUsd(Number(r.credit), String(r.currency)), 0),
        collectedMonthCents: collected.reduce((s, r) => s + toUsd(Number(r.total), String(r.currency)), 0),
        currency: "USD",
      },
      upcomingAppointments: appointments,
      recentActivity: activity,
      unreadNotifications: unread[0].n,
      renewingSoonDays: env.RENEWING_SOON_DAYS,
    };
  });
}

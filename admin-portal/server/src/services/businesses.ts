import { sql, type Db } from "../db.js";
import { env } from "../env.js";
import { badRequest, conflict, notFound } from "../errors.js";
import type { AdminCtx } from "../auth.js";
import { logActivity } from "./activity.js";
import { notifyTeam } from "./notify.js";
import { createInvoice, getBalance, settleBusiness } from "./invoices.js";
import { mirrorPortalSubscription, provisionPortalAccount, resolveAuthUser } from "./ownerAccount.js";

export type SubscriptionInfo = {
  id: string;
  tierId: string;
  status: string;
  startedAt: Date;
  currentPeriodStart: Date;
  renewsAt: Date;
  interval: string;
  currency: string;
  tierPriceCents: number;
  seatPriceCents: number;
  baseSeats: number;
  extraSeats: number;
  totalSeats: number;
};

export type BusinessSummary = {
  id: string;
  name: string;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  address: string | null;
  businessType: string | null;
  tierId: string | null;
  tierName: string | null;
  pipelineStatus: string;
  setupAppointmentAt: Date | null;
  setupCompletedAt: Date | null;
  ownerEmail: string | null;
  ownerUserId: string | null;
  organizationId: string | null;
  notes: string | null;
  createdAt: Date;
  subscription: SubscriptionInfo | null;
  renewingSoon: boolean;
  openCents: number;
  balanceCents: number;
  owedCents: number;
  creditCents: number;
};

function mapSummary(r: any): BusinessSummary {
  const subscription: SubscriptionInfo | null = r.sub_id
    ? {
        id: r.sub_id,
        tierId: r.sub_tier_id,
        status: r.sub_status,
        startedAt: r.sub_started_at,
        currentPeriodStart: r.sub_period_start,
        renewsAt: r.sub_renews_at,
        interval: r.sub_interval,
        currency: r.sub_currency,
        tierPriceCents: Number(r.tier_price_cents),
        seatPriceCents: Number(r.seat_price_cents),
        baseSeats: Number(r.base_seats),
        extraSeats: Number(r.extra_seats),
        totalSeats: Number(r.base_seats) + Number(r.extra_seats),
      }
    : null;

  const openCents = Number(r.open_cents);
  const paidCents = Number(r.paid_cents);
  const appliedCents = Number(r.applied_cents);
  const balanceCents = openCents - (paidCents - appliedCents);

  return {
    id: r.id,
    name: r.name,
    contactName: r.contact_name,
    contactEmail: r.contact_email,
    contactPhone: r.contact_phone,
    address: r.address,
    businessType: r.business_type,
    tierId: r.tier_id,
    tierName: r.tier_name,
    pipelineStatus: r.pipeline_status,
    setupAppointmentAt: r.setup_appointment_at,
    setupCompletedAt: r.setup_completed_at,
    ownerEmail: r.owner_email,
    ownerUserId: r.owner_user_id,
    organizationId: r.organization_id,
    notes: r.notes,
    createdAt: r.created_at,
    subscription,
    renewingSoon: Boolean(r.renewing_soon),
    openCents,
    balanceCents,
    owedCents: Math.max(0, balanceCents),
    creditCents: Math.max(0, -balanceCents),
  };
}

const SUMMARY_SELECT = `
with money as (
  select b.id as business_id,
         coalesce((select sum(i.amount_cents) from adm_invoices i
                   where i.business_id = b.id and i.status = 'open'), 0) as open_cents,
         coalesce((select sum(p.amount_cents) from adm_payments p
                   where p.business_id = b.id), 0) as paid_cents,
         coalesce((select sum(a.amount_cents) from adm_payment_applications a
                   join adm_payments p on p.id = a.payment_id
                   where p.business_id = b.id), 0) as applied_cents
  from adm_businesses b
)
select b.id, b.name, b.contact_name, b.contact_email, b.contact_phone, b.address,
       b.business_type, b.tier_id, b.pipeline_status, b.setup_appointment_at,
       b.setup_completed_at, b.owner_user_id, b.owner_email, b.organization_id,
       b.notes, b.created_at,
       t.name as tier_name,
       s.id as sub_id, s.tier_id as sub_tier_id, s.status as sub_status, s.started_at as sub_started_at,
       s.current_period_start as sub_period_start, s.renews_at as sub_renews_at,
       s.interval as sub_interval, s.currency as sub_currency,
       s.tier_price_cents, s.seat_price_cents, s.base_seats, s.extra_seats,
       case when s.id is not null and s.status = 'active'
                 and s.renews_at <= now() + make_interval(days => $renewingSoonDays)
            then true else false end as renewing_soon,
       m.open_cents, m.paid_cents, m.applied_cents
from adm_businesses b
left join adm_tiers t on t.id = b.tier_id
left join adm_subscriptions s on s.business_id = b.id
join money m on m.business_id = b.id`;

export type ListParams = {
  q?: string;
  pipeline?: string;
  billing?: string;
  balance?: string;
  limit?: number;
  offset?: number;
};

export async function listBusinesses(params: ListParams): Promise<BusinessSummary[]> {
  const limit = Math.min(Math.max(params.limit ?? 50, 1), 200);
  const offset = Math.max(params.offset ?? 0, 0);
  const q = params.q?.trim() ? params.q!.trim() : null;
  const pipeline = params.pipeline ?? null;
  const billing = params.billing ?? null;
  const balance = params.balance ?? null;

  const rows = await sql.unsafe(
    `${SUMMARY_SELECT}
     where ($1::text is null or b.name ilike '%' || $1 || '%'
            or coalesce(b.contact_name, '') ilike '%' || $1 || '%'
            or coalesce(b.contact_email, '') ilike '%' || $1 || '%')
       and ($2::text is null or b.pipeline_status = $2)
       and ($3::text is null or (case when s.id is null then 'none' else s.status end) = $3)
       and ($4::text is null
            or ($4 = 'owed'   and (m.open_cents - (m.paid_cents - m.applied_cents)) > 0)
            or ($4 = 'credit' and (m.open_cents - (m.paid_cents - m.applied_cents)) < 0)
            or ($4 = 'clear'  and (m.open_cents - (m.paid_cents - m.applied_cents)) = 0))
     order by b.created_at desc
     limit ${limit} offset ${offset}`.replace(/\$renewingSoonDays/g, String(env.RENEWING_SOON_DAYS)),
    [q, pipeline, billing, balance]
  );
  return rows.map(mapSummary);
}

export async function getBusinessSummary(businessId: string, db: Db = sql): Promise<BusinessSummary | null> {
  const rows = await db.unsafe(
    `${SUMMARY_SELECT} where b.id = $1`.replace(/\$renewingSoonDays/g, String(env.RENEWING_SOON_DAYS)),
    [businessId]
  );
  return rows.length ? mapSummary(rows[0]) : null;
}

export type BusinessDetail = BusinessSummary & {
  invoices: any[];
  payments: any[];
  activity: any[];
  staff: { profileAccounts: number | null; employeeRecords: number | null };
};

export async function getBusinessDetail(businessId: string): Promise<BusinessDetail | null> {
  const summary = await getBusinessSummary(businessId, sql);
  if (!summary) return null;

  const [invoices, payments, activity] = await Promise.all([
    sql`select * from adm_invoices where business_id = ${businessId} order by created_at desc`,
    sql`
      select p.*, coalesce(a.applied, 0) as applied_cents
      from adm_payments p
      left join (
        select payment_id, sum(amount_cents) as applied
        from adm_payment_applications group by payment_id
      ) a on a.payment_id = p.id
      where p.business_id = ${businessId}
      order by p.received_at desc, p.created_at desc`,
    sql`
      select * from adm_activity_log
      where business_id = ${businessId}
      order by created_at desc
      limit 100`,
  ]);

  let staff: BusinessDetail["staff"] = { profileAccounts: null, employeeRecords: null };
  if (summary.organizationId) {
    const rows = await sql`
      select
        (select count(*) from profiles where organization_id = ${summary.organizationId})::int as profiles,
        (select count(*) from employees e
           join stores st on st.id = e.store_id
          where st.organization_id = ${summary.organizationId} and e.is_deleted = false)::int as employees`;
    staff = { profileAccounts: rows[0].profiles, employeeRecords: rows[0].employees };
  }

  return { ...summary, invoices, payments, activity, staff };
}

export type CreateBusinessInput = {
  name: string;
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
  address?: string;
  tierId?: string;
  notes?: string;
};

export async function createBusiness(input: CreateBusinessInput, ctx: AdminCtx): Promise<BusinessSummary> {
  const name = input.name.trim();
  if (name.length < 2) throw badRequest("Business name is too short.");

  if (input.tierId) {
    const tier = await sql`select id from adm_tiers where id = ${input.tierId}`;
    if (tier.length === 0) throw badRequest("That tier does not exist.");
  }

  const rows = await sql`
    insert into adm_businesses
      (name, contact_name, contact_email, contact_phone, address, tier_id, notes, registered_by, pipeline_status)
    values
      (${name}, ${input.contactName ?? null}, ${input.contactEmail?.trim().toLowerCase() ?? null},
       ${input.contactPhone ?? null}, ${input.address ?? null}, ${input.tierId ?? null},
       ${input.notes ?? null}, ${ctx.adminId}, 'prospect')
    returning id`;
  const businessId = rows[0].id as string;

  await logActivity({
    action: "business.registered",
    summary: `${ctx.fullName} registered a new prospective customer: ${name}`,
    actorType: "admin",
    actorLabel: `${ctx.fullName} (${ctx.email})`,
    adminId: ctx.adminId,
    businessId,
    metadata: { contactEmail: input.contactEmail ?? null },
  });
  await notifyTeam({
    type: "business_registered",
    title: "New business registered",
    body: `${name} was added to the pipeline by ${ctx.fullName}.`,
    businessId,
    link: `/businesses/${businessId}`,
    excludeAdminId: ctx.adminId,
  });

  const summary = await getBusinessSummary(businessId);
  if (!summary) throw notFound("Business not found after creation.");
  return summary;
}

export async function bookAppointment(
  businessId: string,
  appointmentAt: string,
  ctx: AdminCtx
): Promise<BusinessSummary> {
  const when = new Date(appointmentAt);
  if (Number.isNaN(when.getTime())) throw badRequest("Invalid appointment date.");

  const rows = await sql`
    update adm_businesses
    set setup_appointment_at = ${when},
        pipeline_status = case
          when pipeline_status in ('prospect', 'paid') then 'setup_scheduled'
          else pipeline_status end
    where id = ${businessId} and pipeline_status <> 'setup_complete'
    returning id, name, pipeline_status, setup_appointment_at`;
  if (rows.length === 0) {
    const exists = await sql`select id from adm_businesses where id = ${businessId}`;
    if (exists.length === 0) throw notFound("Business not found.");
    throw conflict("Setup is already complete for this business.", "already_setup");
  }

  const business = rows[0];
  await logActivity({
    action: "appointment.booked",
    summary: `${ctx.fullName} booked setup for ${business.name} on ${when.toISOString().slice(0, 10)}`,
    actorType: "admin",
    actorLabel: `${ctx.fullName} (${ctx.email})`,
    adminId: ctx.adminId,
    businessId,
    metadata: { appointmentAt: when.toISOString() },
  });
  await notifyTeam({
    type: "appointment_booked",
    title: "Setup appointment booked",
    body: `${business.name} — setup scheduled for ${when.toISOString().slice(0, 10)} by ${ctx.fullName}.`,
    businessId,
    link: `/businesses/${businessId}`,
    excludeAdminId: ctx.adminId,
  });

  const summary = await getBusinessSummary(businessId);
  if (!summary) throw notFound("Business not found.");
  return summary;
}

export type CompleteSetupInput = {
  ownerEmail: string;
  ownerFullName: string;
  tempPassword: string;
  businessType: string;
  tierId?: string;
  storeName?: string;
  language?: "ht" | "fr" | "en";
};

export type CompleteSetupResult = {
  business: BusinessSummary;
  ownerEmail: string;
  organizationId: string;
  renewsAt: Date;
  balanceCents: number;
};

/**
 * Technician completes setup. This single action:
 *   - creates the owner's portal account with the temporary password,
 *   - configures the business type and tier,
 *   - starts the subscription — the billing clock begins HERE, not at the
 *     original payment date.
 */
export async function completeSetup(
  businessId: string,
  input: CompleteSetupInput,
  ctx: AdminCtx
): Promise<CompleteSetupResult> {
  const email = input.ownerEmail.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw badRequest("A valid owner email is required.");
  if (input.tempPassword.length < 8) throw badRequest("Temporary password must be at least 8 characters.");
  if (!input.businessType?.trim()) throw badRequest("Business type is required.");

  const existing = await getBusinessSummary(businessId);
  if (!existing) throw notFound("Business not found.");
  if (existing.pipelineStatus === "setup_complete") {
    throw conflict("Setup has already been completed for this business.", "already_setup");
  }

  const tierId = input.tierId ?? existing.tierId;
  if (!tierId) throw badRequest("Choose a subscription tier to start billing.");
  const tiers = await sql`
    select id, name, price_cents, seat_price_cents, base_seats, interval, currency
    from adm_tiers where id = ${tierId} and is_active = true`;
  if (tiers.length === 0) throw badRequest("That tier is not available.");
  const tier = tiers[0];

  // Guard before touching auth: this email must not already run a business here.
  const profileCheck = await sql`
    select id, organization_id from profiles where lower(email) = lower(${email}) limit 1`;
  if (profileCheck.length > 0 && profileCheck[0].organization_id) {
    throw conflict("That email already belongs to an existing portal account.", "email_in_use");
  }

  // Auth user first (cannot be rolled back), then everything else atomically.
  const ownerUserId = await resolveAuthUser(email, input.tempPassword);
  const storeName = input.storeName?.trim() || existing.name;
  const language = input.language ?? "ht";

  return sql.begin(async (tx) => {
    const portal = await provisionPortalAccount(tx, {
      userId: ownerUserId,
      email,
      fullName: input.ownerFullName.trim() || existing.name,
      language,
      storeName,
    });

    // Billing clock starts at this moment.
    const subRows = await tx`
      insert into adm_subscriptions
        (business_id, tier_id, status, started_at, current_period_start, renews_at,
         interval, currency, tier_price_cents, seat_price_cents, base_seats, extra_seats)
      values
        (${businessId}, ${tier.id}, 'active', now(), now(),
         now() + case when ${tier.interval} = 'yearly' then interval '1 year' else interval '1 month' end,
         ${tier.interval}, ${tier.currency}, ${tier.price_cents}, ${tier.seat_price_cents}, ${tier.base_seats}, 0)
      returning *`;
    const sub = subRows[0];

    await mirrorPortalSubscription(tx, {
      organizationId: portal.organizationId,
      startedAt: sub.started_at,
      renewsAt: sub.renews_at,
    });

    // First invoice for the period; any payment sales already collected
    // settles against it automatically below.
    const invoiceCount = await tx`
      select count(*)::int as n from adm_invoices where business_id = ${businessId}`;
    if (invoiceCount[0].n === 0) {
      await createInvoice(tx, {
        businessId,
        subscriptionId: sub.id,
        kind: "initial",
        description: `Initial subscription period — ${tier.name}`,
        amountCents: Number(tier.price_cents),
        periodStart: sub.started_at,
        periodEnd: sub.renews_at,
        dueAt: sub.started_at,
        createdBy: ctx.adminId,
      });
    } else {
      await tx`
        update adm_invoices
        set subscription_id = ${sub.id},
            period_start = ${sub.started_at},
            period_end = ${sub.renews_at},
            due_at = ${sub.started_at},
            description = ${`Initial subscription period — ${tier.name}`}
        where business_id = ${businessId} and kind = 'initial'`;
    }

    await settleBusiness(tx, businessId);
    const balance = await getBalance(businessId, tx);

    await tx`
      update adm_businesses
      set pipeline_status = 'setup_complete',
          setup_completed_at = ${sub.started_at},
          owner_user_id = ${ownerUserId},
          owner_email = ${email},
          business_type = ${input.businessType.trim()},
          tier_id = ${tier.id}
      where id = ${businessId}`;

    await logActivity(
      {
        action: "setup.completed",
        summary: `${ctx.fullName} completed setup for ${existing.name} — owner account created, billing started (renews ${sub.renews_at.toISOString().slice(0, 10)})`,
        actorType: "admin",
        actorLabel: `${ctx.fullName} (${ctx.email})`,
        adminId: ctx.adminId,
        businessId,
        metadata: {
          ownerEmail: email,
          tierId: tier.id,
          tierName: tier.name,
          startedAt: sub.started_at,
          renewsAt: sub.renews_at,
          balanceCents: balance.balanceCents,
        },
      },
      tx
    );
    await notifyTeam(
      {
        type: "setup_completed",
        title: "Setup completed — billing started",
        body: `${existing.name} is live on ${tier.name}. Subscription billing started today (not the payment date); first renewal ${sub.renews_at.toISOString().slice(0, 10)}.`,
        businessId,
        link: `/businesses/${businessId}`,
        excludeAdminId: ctx.adminId,
      },
      tx
    );

    const business = await getBusinessSummary(businessId, tx);
    if (!business) throw notFound("Business not found after setup.");

    return {
      business,
      ownerEmail: email,
      organizationId: portal.organizationId,
      renewsAt: sub.renews_at,
      balanceCents: balance.balanceCents,
    };
  });
}

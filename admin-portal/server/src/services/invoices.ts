import { sql, type Db } from "../db.js";

export type InvoiceKind = "initial" | "renewal" | "seat_proration" | "manual" | "tier_upgrade";

export type InvoiceInput = {
  businessId: string;
  subscriptionId?: string | null;
  kind: InvoiceKind;
  description: string;
  amountCents: number;
  periodStart?: Date | string | null;
  periodEnd?: Date | string | null;
  dueAt?: Date | string | null;
  createdBy?: string | null;
};

export async function createInvoice(db: Db, input: InvoiceInput) {
  const rows = await db`
    insert into adm_invoices
      (business_id, subscription_id, kind, description, amount_cents,
       period_start, period_end, due_at, created_by)
    values
      (${input.businessId}, ${input.subscriptionId ?? null}, ${input.kind}, ${input.description},
       ${input.amountCents}, ${input.periodStart ?? null}, ${input.periodEnd ?? null},
       ${input.dueAt ?? null}, ${input.createdBy ?? null})
    returning *`;
  return rows[0];
}

export type Balance = {
  openCents: number;
  paidCents: number;
  appliedCents: number;
  /** Positive = customer owes money, negative = they hold a credit. */
  balanceCents: number;
  owedCents: number;
  creditCents: number;
};

export async function getBalance(businessId: string, db: Db = sql): Promise<Balance> {
  const rows = await db`
    select
      coalesce((select sum(amount_cents) from adm_invoices
                where business_id = ${businessId} and status = 'open'), 0)::bigint as open_cents,
      coalesce((select sum(amount_cents) from adm_payments
                where business_id = ${businessId}), 0)::bigint as paid_cents,
      coalesce((select sum(a.amount_cents)
                from adm_payment_applications a
                join adm_payments p on p.id = a.payment_id
                where p.business_id = ${businessId}), 0)::bigint as applied_cents`;
  const row = rows[0];
  const openCents = Number(row.open_cents);
  const paidCents = Number(row.paid_cents);
  const appliedCents = Number(row.applied_cents);
  const unapplied = paidCents - appliedCents;
  const balanceCents = openCents - unapplied;
  return {
    openCents,
    paidCents,
    appliedCents,
    balanceCents,
    owedCents: Math.max(0, balanceCents),
    creditCents: Math.max(0, -balanceCents),
  };
}

/**
 * FIFO settlement: spreads unapplied payments across the oldest open invoices
 * and flips invoices to `paid` once covered. Call inside a transaction — the
 * `for update` locks make concurrent settlements serialize.
 */
export async function settleBusiness(db: Db, businessId: string): Promise<{ applied: number }> {
  const payments = await db`
    select p.id,
           p.amount_cents - coalesce(a.applied, 0) as remaining
    from adm_payments p
    left join (
      select payment_id, sum(amount_cents) as applied
      from adm_payment_applications group by payment_id
    ) a on a.payment_id = p.id
    where p.business_id = ${businessId}
      and p.amount_cents > coalesce(a.applied, 0)
    order by p.received_at, p.created_at
    for update of p`;

  const invoices = await db`
    select i.id,
           i.amount_cents - coalesce(a.applied, 0) as remaining
    from adm_invoices i
    left join (
      select invoice_id, sum(amount_cents) as applied
      from adm_payment_applications group by invoice_id
    ) a on a.invoice_id = i.id
    where i.business_id = ${businessId}
      and i.status = 'open'
      and i.amount_cents > coalesce(a.applied, 0)
    order by i.created_at
    for update of i`;

  let appliedTotal = 0;
  let paymentIndex = 0;
  for (const invoice of invoices) {
    let need = Number(invoice.remaining);
    while (need > 0 && paymentIndex < payments.length) {
      const payment = payments[paymentIndex];
      const available = Number(payment.remaining);
      if (available <= 0) {
        paymentIndex += 1;
        continue;
      }
      const amount = Math.min(need, available);
      await db`
        insert into adm_payment_applications (payment_id, invoice_id, amount_cents)
        values (${payment.id}, ${invoice.id}, ${amount})`;
      need -= amount;
      appliedTotal += amount;
      payments[paymentIndex] = { ...payment, remaining: available - amount };
    }
  }

  await db`
    update adm_invoices i
    set status = 'paid'
    where i.business_id = ${businessId}
      and i.status = 'open'
      and i.amount_cents <= coalesce(
        (select sum(a.amount_cents) from adm_payment_applications a where a.invoice_id = i.id), 0)`;

  return { applied: appliedTotal };
}

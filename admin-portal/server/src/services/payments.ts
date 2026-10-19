import { sql } from "../db.js";
import { notFound } from "../errors.js";
import type { AdminCtx } from "../auth.js";
import { logActivity } from "./activity.js";
import { notifyTeam } from "./notify.js";
import { createInvoice, getBalance, settleBusiness } from "./invoices.js";
import { formatCents } from "./money.js";
import { reactivateIfSettled } from "./billing.js";
import { sendPaymentReceipt, type PaymentReceipt, type ReceiptLine } from "./receipt.js";

export type RecordPaymentInput = {
  amountCents: number;
  method?: "cash" | "card" | "transfer" | "mobile_money" | "other";
  reference?: string;
  notes?: string;
  receivedAt?: string;
};

/**
 * Sales records a payment ("marks them paid"). The money is applied FIFO
 * across open invoices; anything left over stays as credit for the next
 * invoice. No approval gate — the action is logged and the team notified.
 */
export async function recordPayment(businessId: string, input: RecordPaymentInput, ctx: AdminCtx) {
  const outcome = await sql.begin(async (tx) => {
    const business = await tx`
      select b.id, b.name, b.owner_email, b.pipeline_status, b.tier_id,
             t.name as tier_name, t.price_cents as tier_price_cents,
             coalesce(s.currency, t.currency, 'USD') as business_currency
      from adm_businesses b
      left join adm_tiers t on t.id = b.tier_id
      left join adm_subscriptions s on s.business_id = b.id
      where b.id = ${businessId}
      for update of b`;
    if (business.length === 0) throw notFound("Business not found.");
    const bus = business[0];

    // If a tier is already known and nothing has been invoiced yet, create the
    // initial invoice so the payment has something to settle against.
    const existingInvoices = await tx`
      select id from adm_invoices where business_id = ${businessId} limit 1`;
    if (existingInvoices.length === 0 && bus.tier_id) {
      await createInvoice(tx, {
        businessId,
        kind: "initial",
        description: `Initial subscription period — ${bus.tier_name}`,
        amountCents: Number(bus.tier_price_cents),
        createdBy: ctx.adminId,
      });
    }

    const paymentRows = await tx`
      insert into adm_payments (business_id, amount_cents, currency, method, reference, notes, received_at, recorded_by)
      values (${businessId}, ${input.amountCents}, ${bus.business_currency}, ${input.method ?? 'other'},
              ${input.reference ?? null}, ${input.notes ?? null},
              ${input.receivedAt ? new Date(input.receivedAt) : new Date()}, ${ctx.adminId})
      returning *`;
    const payment = paymentRows[0];

    const settlement = await settleBusiness(tx, businessId);

    if (bus.pipeline_status === "prospect") {
      await tx`
        update adm_businesses set pipeline_status = 'paid' where id = ${businessId}`;
    }

    await reactivateIfSettled(businessId, tx);

    const balance = await getBalance(businessId, tx);
    const amount = formatCents(Number(payment.amount_cents), payment.currency);

    await logActivity(
      {
        action: "payment.recorded",
        summary: `${ctx.fullName} recorded a payment of ${amount} for ${bus.name}`,
        actorType: "admin",
        actorLabel: `${ctx.fullName} (${ctx.email})`,
        adminId: ctx.adminId,
        businessId,
        metadata: {
          paymentId: payment.id,
          amountCents: Number(payment.amount_cents),
          method: payment.method,
          appliedCents: settlement.applied,
          balanceCents: balance.balanceCents,
        },
      },
      tx
    );
    await notifyTeam(
      {
        type: "payment_recorded",
        title: "Payment recorded",
        body: `${bus.name} — ${amount} received from ${ctx.fullName}. ${
          balance.owedCents > 0
            ? `Still owed: ${formatCents(balance.owedCents, payment.currency)}.`
            : balance.creditCents > 0
              ? `Credit on file: ${formatCents(balance.creditCents, payment.currency)}.`
              : "Balance is clear."
        }`,
        businessId,
        link: `/businesses/${businessId}`,
        excludeAdminId: ctx.adminId,
      },
      tx
    );

    const receiptLines = await tx`
      select i.number, i.kind, i.description,
             i.amount_cents as invoice_amount_cents,
             a.amount_cents as applied_cents
      from adm_payment_applications a
      join adm_invoices i on i.id = a.invoice_id
      where a.payment_id = ${payment.id}
      order by i.created_at asc`;

    return {
      payment,
      balance,
      pipelineStatus: bus.pipeline_status === "prospect" ? "paid" : bus.pipeline_status,
      businessName: String(bus.name),
      ownerEmail: (bus.owner_email ?? null) as string | null,
      receiptLines: receiptLines.map((l) => ({
        number: String(l.number),
        kind: String(l.kind),
        description: String(l.description),
        invoiceAmountCents: Number(l.invoice_amount_cents),
        appliedCents: Number(l.applied_cents),
      })) satisfies ReceiptLine[],
    };
  });

  // After commit: email the owner a receipt with the applied-invoice breakdown.
  // Mail problems are reported inside `receipt` but never fail the payment.
  const receipt = await sendPaymentReceipt({
    businessName: outcome.businessName,
    ownerEmail: outcome.ownerEmail,
    payment: {
      id: outcome.payment.id,
      amountCents: Number(outcome.payment.amount_cents),
      currency: String(outcome.payment.currency),
      method: String(outcome.payment.method),
      reference: (outcome.payment.reference ?? null) as string | null,
      receivedAt: outcome.payment.received_at,
    },
    lines: outcome.receiptLines,
    balanceAfterCents: outcome.balance.balanceCents,
  });

  return {
    payment: outcome.payment,
    balance: outcome.balance,
    pipelineStatus: outcome.pipelineStatus,
    receipt,
  };
}

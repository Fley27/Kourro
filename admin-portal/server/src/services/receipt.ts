import { sendMail } from "./email.js";
import { formatCents } from "./money.js";

const KIND_LABEL: Record<string, string> = {
  initial: "Initial period",
  renewal: "Renewal",
  seat_proration: "Seat proration",
  tier_upgrade: "Tier upgrade",
  manual: "Manual",
};

export type ReceiptLine = {
  number: string;
  kind: string;
  description: string;
  invoiceAmountCents: number;
  appliedCents: number;
};

export type PaymentReceipt = {
  sent: boolean;
  to: string | null;
  error?: string;
};

function receivedAtLabel(value: Date | string): string {
  const d = typeof value === "string" ? new Date(value) : value;
  return `${d.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

function balanceLabel(balanceAfterCents: number, currency: string): string {
  if (balanceAfterCents > 0) return `${formatCents(balanceAfterCents, currency)} still owed`;
  if (balanceAfterCents < 0) return `${formatCents(-balanceAfterCents, currency)} credit on file`;
  return `${formatCents(0, currency)} — settled`;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * Emails the business owner a receipt for a recorded payment, listing every
 * invoice the payment was applied to (FIFO), method, reference and the
 * balance afterwards. Returns { sent: false } when there is no owner email.
 */
export async function sendPaymentReceipt(args: {
  businessName: string;
  ownerEmail: string | null;
  payment: {
    id: string;
    amountCents: number;
    currency: string;
    method: string;
    reference: string | null;
    receivedAt: Date | string;
  };
  lines: ReceiptLine[];
  balanceAfterCents: number;
}): Promise<PaymentReceipt> {
  const { businessName, ownerEmail, payment, lines, balanceAfterCents } = args;
  if (!ownerEmail) return { sent: false, to: null };

  const currency = payment.currency;
  const amount = formatCents(Number(payment.amountCents), currency);
  const totalApplied = lines.reduce((sum, line) => sum + Number(line.appliedCents), 0);
  const method = payment.method.replace(/_/g, " ");

  const textRows = lines.map(
    (line) =>
      `  ${line.number.padEnd(14)} ${(KIND_LABEL[line.kind] ?? line.kind).padEnd(16)} ${formatCents(Number(line.appliedCents), currency).padStart(14)}`
  );
  const textParts = [
    "KOURRO — Payment receipt",
    "",
    `Business:  ${businessName}`,
    `Received:  ${receivedAtLabel(payment.receivedAt)}`,
    `Method:    ${method}`,
    `Reference: ${payment.reference ?? "—"}`,
    `Amount:    ${amount}`,
  ];
  if (lines.length > 0) {
    textParts.push("", "Applied to invoices:", ...textRows, `  ${"Total applied".padEnd(31)}${formatCents(totalApplied, currency).padStart(14)}`);
  } else {
    textParts.push("", "No open invoices at time of payment — amount kept as credit.");
  }
  textParts.push(
    "",
    `Balance after payment: ${balanceLabel(balanceAfterCents, currency)}`,
    "",
    "Questions? Reply to this email.",
    "— Kourro, built to deliver"
  );
  const text = textParts.join("\n");

  const rowHtml = lines
    .map(
      (line) =>
        `<tr><td style="padding:6px 10px;border-bottom:1px solid #eee;">${escapeHtml(line.number)}</td>` +
        `<td style="padding:6px 10px;border-bottom:1px solid #eee;">${escapeHtml(KIND_LABEL[line.kind] ?? line.kind)}<div style="color:#777;font-size:12px;">${escapeHtml(line.description)}</div></td>` +
        `<td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right;white-space:nowrap;">${formatCents(Number(line.appliedCents), currency)}</td></tr>`
    )
    .join("");
  const html = `
<div style="font-family:Inter,Arial,sans-serif;max-width:560px;margin:0 auto;color:#111;">
  <div style="font-size:20px;font-weight:700;letter-spacing:2px;">KOURRO</div>
  <div style="color:#777;margin-bottom:18px;">Payment receipt</div>
  <p style="margin:0 0 4px;"><strong>${escapeHtml(businessName)}</strong></p>
  <p style="margin:0 0 2px;color:#555;">Received: ${receivedAtLabel(payment.receivedAt)}</p>
  <p style="margin:0 0 2px;color:#555;">Method: ${escapeHtml(method)}${payment.reference ? ` • Reference: ${escapeHtml(payment.reference)}` : ""}</p>
  <p style="margin:12px 0;font-size:22px;font-weight:700;">${amount}</p>
  ${
    lines.length > 0
      ? `<table style="border-collapse:collapse;width:100%;font-size:14px;margin:14px 0;">
      <thead><tr><th style="padding:6px 10px;text-align:left;border-bottom:2px solid #111;">Invoice</th><th style="padding:6px 10px;text-align:left;border-bottom:2px solid #111;">Applied to</th><th style="padding:6px 10px;text-align:right;border-bottom:2px solid #111;">Amount</th></tr></thead>
      <tbody>${rowHtml}
        <tr><td style="padding:8px 10px;"></td><td style="padding:8px 10px;font-weight:600;">Total applied</td><td style="padding:8px 10px;text-align:right;font-weight:600;">${formatCents(totalApplied, currency)}</td></tr>
      </tbody></table>`
      : `<p style="color:#555;">No open invoices at time of payment — amount kept as credit.</p>`
  }
  <p style="margin-top:10px;"><strong>Balance after payment:</strong> ${balanceLabel(balanceAfterCents, currency)}</p>
  <p style="color:#777;font-size:13px;margin-top:24px;">Questions? Reply to this email.<br/>— Kourro, built to deliver</p>
</div>`;

  try {
    const sent = await sendMail({
      to: ownerEmail,
      subject: `Payment receipt — ${businessName}`,
      text,
      html,
    });
    return { sent, to: ownerEmail };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[email] receipt for ${businessName} (${payment.id}) failed: ${message}`);
    return { sent: false, to: ownerEmail, error: message };
  }
}

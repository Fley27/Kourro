import { env } from "../env.js";

export type MailMessage = {
  to: string;
  toName?: string;
  subject: string;
  text: string;
  html?: string;
};

function parseFrom(raw: string): { name: string; email: string } {
  const match = raw.match(/^\s*"?([^"<]*)"?\s*<([^>]+)>\s*$/);
  if (match) return { name: (match[1] ?? "").trim() || "Kourro", email: match[2].trim() };
  return { name: "Kourro", email: raw.trim() };
}

/**
 * Minimal REST mail transport (Mailpit/Inbucket-compatible schema). Configured
 * via EMAIL_REST_URL; when unset every send is skipped with a console warning
 * so billing flows never depend on mail being configured.
 */
export async function sendMail(msg: MailMessage): Promise<boolean> {
  if (!env.EMAIL_REST_URL) {
    console.warn(`[email] skipped "${msg.subject}" → ${msg.to} (EMAIL_REST_URL not configured)`);
    return false;
  }
  const from = parseFrom(env.EMAIL_FROM);
  const res = await fetch(env.EMAIL_REST_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      from: { Name: from.name, Email: from.email },
      to: [{ Name: msg.toName ?? msg.to, Email: msg.to }],
      subject: msg.subject,
      text: msg.text,
      ...(msg.html ? { html: msg.html } : {}),
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`email transport returned ${res.status}: ${body.slice(0, 300)}`);
  }
  return true;
}

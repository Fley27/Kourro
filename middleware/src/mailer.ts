// Shared SMTP transport — extracted so invite mail and the payroll
// period-close summary use the same wiring. Env is read at CALL time (not
// import time) so `tsx watch` picks up .env edits without a rebuild.
import nodemailer from "nodemailer";

export const SMTP_FROM = () => process.env.SMTP_FROM ?? "Kourro <no-reply@kourro.local>";

/** SMTP transport from env — null when unconfigured (mail just skips). */
export function mailer() {
  const host = process.env.SMTP_HOST;
  if (!host) return null;
  return nodemailer.createTransport({
    host,
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: process.env.SMTP_SECURE === "1",
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
  });
}

/** Best-effort send: returns false when SMTP is down or unconfigured. */
export async function sendMail(opts: { to: string; subject: string; text: string }): Promise<boolean> {
  const transport = mailer();
  if (!transport) return false;
  try {
    await transport.sendMail({ from: SMTP_FROM(), ...opts });
    return true;
  } catch {
    return false;
  }
}

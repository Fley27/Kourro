import "dotenv/config";

function num(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export const env = {
  PORT: num(process.env.PORT, 4200),
  DATABASE_URL: process.env.DATABASE_URL ?? "",
  SUPABASE_URL: process.env.SUPABASE_URL ?? "",
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
  RENEWAL_GRACE_DAYS: num(process.env.RENEWAL_GRACE_DAYS, 7),
  RENEWING_SOON_DAYS: num(process.env.RENEWING_SOON_DAYS, 14),
  BILLING_JOB_INTERVAL_MS: num(process.env.BILLING_JOB_INTERVAL_MS, 300_000),
  EMAIL_REST_URL: process.env.EMAIL_REST_URL ?? "",
  EMAIL_FROM: process.env.EMAIL_FROM ?? "Kourro Billing <billing@kourro.test>",
};

export function assertEnv(): string[] {
  const missing: string[] = [];
  if (!env.DATABASE_URL) missing.push("DATABASE_URL");
  if (!env.SUPABASE_URL) missing.push("SUPABASE_URL");
  if (!env.SUPABASE_SERVICE_ROLE_KEY) missing.push("SUPABASE_SERVICE_ROLE_KEY");
  return missing;
}

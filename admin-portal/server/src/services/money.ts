const DAY_MS = 86_400_000;

/**
 * Generic mid-cycle proration: charges `amountCents` only for the days left in
 * the current period, so the change "catches up" to the existing renewal date
 * instead of getting its own anniversary. Used by seat additions and tier
 * upgrades alike — at renewal everything bills as one lump sum, never on
 * staggered dates.
 */
export function prorateCents(opts: {
  amountCents: number;
  periodStart: Date;
  renewsAt: Date;
  now?: Date;
}): number {
  const now = opts.now ?? new Date();
  const totalMs = opts.renewsAt.getTime() - opts.periodStart.getTime();
  const totalDays = Math.max(1, Math.ceil(totalMs / DAY_MS));
  const remainingMs = Math.max(0, opts.renewsAt.getTime() - now.getTime());
  // Minimum one day: the change is usable today.
  const remainingDays = Math.max(1, Math.min(totalDays, Math.ceil(remainingMs / DAY_MS)));
  return Math.round((opts.amountCents * remainingDays) / totalDays);
}

/**
 * Mid-cycle seat proration (thin wrapper over prorateCents).
 */
export function prorateSeatCents(opts: {
  seatPriceCents: number;
  seats: number;
  periodStart: Date;
  renewsAt: Date;
  now?: Date;
}): number {
  return prorateCents({
    amountCents: opts.seatPriceCents * opts.seats,
    periodStart: opts.periodStart,
    renewsAt: opts.renewsAt,
    now: opts.now,
  });
}

export function formatCents(cents: number, currency = "HTG"): string {
  const amount = (cents / 100).toFixed(2);
  return `${amount} ${currency}`;
}

export function dateOnly(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toISOString().slice(0, 10);
}

export function pluralize(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

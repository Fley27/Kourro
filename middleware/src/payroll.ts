// Payroll close engine (migration 028).
//
// One org-wide cycle; the SERVER alone decides closure. A device may trigger
// a close attempt (its local clock saw the period expire, or the sync pull
// safety net fired) but the actual flip happens here, once, with:
//   • one salary snapshot per payable employee (latest salary_history row),
//   • the period's salary-bound deficits summed BY DATE RANGE,
//   • a locked salary_payments row (UNIQUE employee_id+period_id makes any
//     duplicate/concurrent close a no-op),
//   • a Kreyòl summary email to the business's supervisors and owner.
//
// Payable roster: the org's profiles (the cloud's staff truth). Local-only
// employee rows without a profile never reach the cloud, so they cannot be
// paid server-side — their deficits stay visible in the client breakdown.
import { randomUUID } from "node:crypto";
import { supabase, isMockMode } from "./index.js";
import { sendMail } from "./mailer.js";

type Log = { info?: (...a: any[]) => void; warn?: (...a: any[]) => void } | undefined;

/**
 * A period only closes once `end_date` is over in EVERY timezone: compare
 * against the UTC date 12h ago. Haiti (UTC−5) therefore closes at ~07:00
 * local on the 1st — after any late last-evening report has landed, and
 * before anyone looks at payroll the next morning.
 */
function safeCloseDay(): string {
  return new Date(Date.now() - 12 * 3600_000).toISOString().slice(0, 10);
}

const money = (n: number) =>
  "G " + Math.round(n).toLocaleString("en-US", { maximumFractionDigits: 0 });

/**
 * Close every expired open period of the org. Idempotent and race-safe (the
 * status guard + unique payment index); returns how many periods were closed
 * by THIS call.
 */
export async function closeExpiredPeriods(orgId: string | null, log?: Log): Promise<{ closed: number }> {
  if (!orgId || isMockMode) return { closed: 0 };
  try {
    const cutoff = safeCloseDay();
    const { data: open } = await supabase
      .from("pay_periods")
      .select("*")
      .eq("organization_id", orgId)
      .eq("status", "open")
      .eq("is_deleted", false);
    const expired = (open ?? []).filter((p: any) => String(p.end_date) < cutoff);
    let closed = 0;
    for (const p of expired) closed += (await closeOne(orgId, p, log)) ? 1 : 0;
    return { closed };
  } catch (e) {
    log?.warn?.({ err: e }, "payroll close: sweep failed");
    return { closed: 0 };
  }
}

async function closeOne(orgId: string, period: any, log?: Log): Promise<boolean> {
  const periodId = String(period.id);
  const start = String(period.start_date);
  const end = String(period.end_date);
  const now = new Date().toISOString();

  // Re-read: another closer may have flipped it since the sweep listed it.
  const { data: fresh } = await supabase
    .from("pay_periods").select("id,status").eq("id", periodId).maybeSingle();
  if (!fresh || String((fresh as any).status) !== "open") return false;

  // Roster: org profiles (never tombstoned rows).
  const { data: people } = await supabase
    .from("profiles")
    .select("id,email,full_name,role,is_deleted")
    .eq("organization_id", orgId);
  const roster = (people ?? []).filter((p: any) => !p.is_deleted);

  // Latest salary per employee (rows ascend by created_at; last write wins).
  const { data: salRows } = await supabase
    .from("salary_history")
    .select("employee_id,amount,created_at")
    .eq("organization_id", orgId)
    .eq("is_deleted", false);
  const salaryMap = new Map<string, number>();
  for (const r of (salRows ?? []).slice().sort((a: any, b: any) =>
    String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")))) {
    salaryMap.set(String((r as any).employee_id), Number((r as any).amount ?? 0));
  }

  // Deficits by DATE RANGE (never by period_id — a mis-anchored row must not
  // skew a close). Open-ended upper bound covers end-day timestamps too.
  const { data: defRows } = await supabase
    .from("salary_deficits")
    .select("employee_id,amount,date")
    .eq("organization_id", orgId)
    .eq("is_deleted", false)
    .gte("date", start)
    .lte("date", end);
  const deficitMap = new Map<string, number>();
  for (const r of defRows ?? []) {
    const id = String((r as any).employee_id);
    deficitMap.set(id, (deficitMap.get(id) ?? 0) + Number((r as any).amount ?? 0));
  }

  // Locked payment rows. Skip true zeroes (no salary, no deficit); a negative
  // net (deficits > salary) is recorded as-is — the manual-call case.
  const pays: any[] = [];
  let skipped = 0;
  for (const p of roster) {
    const salary = salaryMap.get(String(p.id)) ?? 0;
    const deficit = deficitMap.get(String(p.id)) ?? 0;
    if (salary <= 0 && deficit <= 0) continue;
    pays.push({
      id: randomUUID(),
      employee_id: p.id,
      period_id: periodId,
      organization_id: orgId,
      store_id: null,
      salary_amount: salary,
      deficit_total: deficit,
      net_amount: salary - deficit,
      closed_at: now,
      device_id: null,
      created_at: now,
      updated_at: now,
      is_deleted: false,
      dirty: 0,
    });
    if (deficit > salary) {
      log?.info?.({ employee_id: p.id, salary, deficit }, "payroll close: deficits exceed salary (manual call)");
    }
  }
  for (const pay of pays) {
    const { error } = await supabase.from("salary_payments").insert(pay);
    // Duplicate (concurrent closer got here first): the unique index did its job.
    if (error && !String(error.message).includes("duplicate")) log?.warn?.({ err: error }, "payroll close: payment insert failed");
  }
  // Deficits whose employee has no live profile can't be netted server-side.
  for (const [empId, amount] of deficitMap) {
    if (!roster.some((p: any) => String(p.id) === empId) && amount > 0) {
      skipped++;
    }
  }
  if (skipped) log?.info?.({ skipped }, "payroll close: deficits for profile-less employees kept (not netted)");

  // Flip status LAST, guarded on `open`: whoever wins this update is the
  // closer, and a concurrent caller's update simply matches zero rows.
  const { data: flipped } = await supabase
    .from("pay_periods")
    .update({ status: "closed", closed_at: now, updated_at: now })
    .eq("id", periodId)
    .eq("status", "open")
    .select("id");
  if (!flipped?.length) {
    // Another closer won between our insert and update — rows are identical
    // thanks to the unique index, so nothing more to do.
    return false;
  }

  // Summary email: best-effort, never blocks the close.
  try {
    await emailCloseSummary(orgId, { start, end, pays, log });
  } catch (e) {
    log?.warn?.({ err: e }, "payroll close: summary email failed");
  }
  log?.info?.({ period_id: periodId, payments: pays.length }, "payroll close: period closed");
  return true;
}

async function emailCloseSummary(orgId: string, args: { start: string; end: string; pays: any[]; log?: Log }) {
  const { data: sups } = await supabase
    .from("profiles")
    .select("email,role,is_deleted")
    .eq("organization_id", orgId)
    .in("role", ["owner", "admin", "manager"]);
  const to = [...new Set((sups ?? [])
    .filter((p: any) => !p.is_deleted && p.email)
    .map((p: any) => String(p.email)))];
  if (!to.length) return;

  const totalSalary = args.pays.reduce((s: number, p: any) => s + Number(p.salary_amount ?? 0), 0);
  const totalDeficit = args.pays.reduce((s: number, p: any) => s + Number(p.deficit_total ?? 0), 0);
  const totalNet = args.pays.reduce((s: number, p: any) => s + Number(p.net_amount ?? 0), 0);

  // Gross profit for the period (same math as /api/analytics/profit, org-wide):
  // sales + debt payments − item cost.
  let gross = 0;
  try {
    const { data: stores } = await supabase.from("stores").select("id").eq("organization_id", orgId);
    const storeIds = (stores ?? []).map((s: any) => String(s.id));
    if (storeIds.length) {
      const { data: sales } = await supabase
        .from("sales")
        .select("total, payment_method, created_at, sale_items(cost_price, quantity)")
        .in("store_id", storeIds)
        .gte("created_at", `${args.start}T00:00:00`)
        .lte("created_at", `${args.end}T23:59:59.999`)
        .neq("status", "cancelled")
        .eq("is_deleted", false);
      let revenue = 0;
      let cost = 0;
      for (const s of sales ?? []) {
        revenue += Number((s as any).total ?? 0);
        for (const it of (s as any).sale_items ?? []) {
          cost += Number(it.cost_price ?? 0) * Number(it.quantity ?? 0);
        }
      }
      const { data: pays } = await supabase
        .from("credit_payments").select("amount")
        .in("store_id", storeIds)
        .gte("created_at", `${args.start}T00:00:00`)
        .lte("created_at", `${args.end}T23:59:59.999`);
      const debtPaid = (pays ?? []).reduce((s: number, p: any) => s + Number(p.amount ?? 0), 0);
      gross = revenue + debtPaid - cost;
    }
  } catch {}

  const netProfit = gross - totalNet;
  const text =
    `Peryòd peman an fèmen: ${args.start} → ${args.end}\n\n` +
    `Anplwaye peye: ${args.pays.length}\n` +
    `Total salè: ${money(totalSalary)}\n` +
    `Total deficit sou salè: ${money(totalDeficit)}\n` +
    `Total nèt peye: ${money(totalNet)}\n\n` +
    `Benefis bri peryòd la: ${money(gross)}\n` +
    `Benefis nèt (apre peman salè): ${money(netProfit)}\n`;

  const sent = await sendMail({ to: to.join(", "), subject: `Fen peryòd peman — ${args.start} → ${args.end}`, text });
  if (!sent) args.log?.warn?.("[payroll] SMTP unconfigured/down — close summary email skipped");
}

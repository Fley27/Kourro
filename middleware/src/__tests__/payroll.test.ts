import { describe, it, expect, jest, beforeEach } from "@jest/globals";

const orgId = "org-1";
const periodId = "period-1";

const mockTables: Record<string, any[]> = {};

function rowChain(rows: any[]) {
  let data = rows;
  let filters: any[] = [];
  let cols: any = "*";
  let patch: any = null;

  const apply = () =>
    data.filter((r: any) =>
      filters.every(([c, v, op]: any[]) => {
        const rv = r[c];
        if (op === "eq") return String(rv) === String(v);
        if (op === "in") return (v as any[]).includes(rv);
        if (op === "gte") return String(rv) >= String(v);
        if (op === "lte") return String(rv) <= String(v);
        if (op === "neq") return String(rv) !== String(v);
        return true;
      })
    );

  const chain: any = {
    select: function (_c: any) { cols = _c; return chain; },
    eq: function (col: any, val: any) { filters.push([col, val, "eq"]); return chain; },
    in: function (col: any, vals: any[]) { filters.push([col, vals, "in"]); return chain; },
    gte: function (col: any, val: any) { filters.push([col, val, "gte"]); return chain; },
    lte: function (col: any, val: any) { filters.push([col, val, "lte"]); return chain; },
    neq: function (col: any, val: any) { filters.push([col, val, "neq"]); return chain; },
    order: function () { return chain; },
    limit: function () { return chain; },
    maybeSingle: async function () {
      const match = apply().find((r: any) => true);
      return { data: match ?? null, error: null };
    },
    insert: async function (row: any) {
      data.push(row);
      return { data: [row], error: null };
    },
    update: function (p: any) { patch = p; return chain; },
    then: function (resolve: any) {
      const matched = apply();
      if (patch) {
        for (const r of matched) Object.assign(r, patch);
        resolve({ data: matched, error: null });
      } else {
        resolve({ data: matched, error: null });
      }
    },
  };
  return {
    chain,
    _setRows: (r: any[]) => { data = r; },
    _rows: () => data,
    _patch: () => patch,
  };
}

function mockBuildSupabase() {
  const s: any = {};
  s.from = function (table: string) {
    if (!s[table]) {
      const c = rowChain(mockTables[table] || []);
      s[table] = c.chain;
      s[`_${table}`] = c;
    }
    return s[table];
  };
  return s;
}

const openPeriod = {
  id: periodId,
  organization_id: orgId,
  status: "open",
  is_deleted: false,
  start_date: "2024-01-01",
  end_date: "2024-01-31",
};
const closedPeriod = { ...openPeriod, id: "p-closed", status: "closed" };
const notExpired = { ...openPeriod, id: "p-active", end_date: "2099-12-31" };

jest.mock("../index", () => ({
  supabase: mockBuildSupabase(),
  isMockMode: false,
}));
jest.mock("../mailer", () => ({ sendMail: jest.fn(() => Promise.resolve(true)) }));

import { supabase } from "../index";
import { closeExpiredPeriods } from "../payroll";

function set(table: string, rows: any[]) {
  mockTables[table] = rows;
  // Force-rebuild the chain so it reads the fresh array (not a stale
  // reference captured by an earlier from() call).
  delete (supabase as any)[table];
  delete (supabase as any)[`_${table}`];
  void supabase.from(table);
}

describe("closeExpiredPeriods", () => {
  beforeEach(() => {
    set("pay_periods", []);
    set("profiles", []);
    set("salary_history", []);
    set("salary_deficits", []);
    set("salary_payments", []);
    set("stores", []);
    set("sales", []);
    set("credit_payments", []);
  });

  it("closes an expired open period and inserts a salary payment", async () => {
    set("pay_periods", [openPeriod]);
    set("profiles", [{ id: "emp-1", organization_id: orgId, email: "a@x.com", full_name: "A", role: "owner", is_deleted: false }]);
    set("salary_history", [{ employee_id: "emp-1", organization_id: orgId, amount: 100, created_at: "2024-01-01T00:00:00Z", is_deleted: false }]);

    const res = await closeExpiredPeriods(orgId);
    expect(res.closed).toBe(1);
    const payments = supabase._salary_payments._rows();
    expect(payments.length).toBe(1);
    expect(payments[0].employee_id).toBe("emp-1");
    expect(payments[0].net_amount).toBe(100);
    const flipped = supabase._pay_periods._rows().find((r: any) => r.id === periodId);
    expect(flipped.status).toBe("closed");
  });

  it("skips non-expired and already-closed periods", async () => {
    set("pay_periods", [closedPeriod, notExpired]);
    set("profiles", []);
    set("salary_history", []);

    const res = await closeExpiredPeriods(orgId);
    expect(res.closed).toBe(0);
    expect(supabase._salary_payments._rows().length).toBe(0);
  });

  it("returns { closed: 0 } when orgId is null", async () => {
    expect(await closeExpiredPeriods(null as any)).toEqual({ closed: 0 });
  });
});

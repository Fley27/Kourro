import { describe, it, expect } from "@jest/globals";
import {
  incrementClock,
  mergeClocks,
  compareClocks,
  resolveLWW,
  mergeStockQuantity,
  toChange,
  sortChangesByClock,
  nextRetryDelay,
  reconcileIncoming,
} from "../index";

describe("incrementClock", () => {
  it("bumps a device's counter and leaves others untouched", () => {
    const clock = { d1: 2, d2: 3 };
    expect(incrementClock(clock, "d1")).toEqual({ d1: 3, d2: 3 });
    expect(incrementClock(clock, "d3")).toEqual({ d1: 2, d2: 3, d3: 1 });
  });
  it("does not mutate the input", () => {
    const clock = { d1: 1 };
    incrementClock(clock, "d1");
    expect(clock).toEqual({ d1: 1 });
  });
});

describe("mergeClocks", () => {
  it("takes the per-device max", () => {
    expect(mergeClocks({ a: 1, b: 5 }, { a: 3, b: 2, c: 4 })).toEqual({ a: 3, b: 5, c: 4 });
  });
});

describe("compareClocks", () => {
  it("orders dominating clocks", () => {
    expect(compareClocks({ d: 3 }, { d: 2 })).toBe("a_before_b");
    expect(compareClocks({ d: 2 }, { d: 3 })).toBe("b_before_a");
  });
  it("reports concurrent when each dominates on a different device", () => {
    expect(compareClocks({ d1: 2, d2: 1 }, { d1: 1, d2: 2 })).toBe("concurrent");
  });
  it("reports equal when identical", () => {
    expect(compareClocks({ d: 2 }, { d: 2 })).toBe("equal");
    expect(compareClocks({}, {})).toBe("equal");
  });
});

describe("resolveLWW", () => {
  const base = { id: "x", device_id: "d1", lamport_clock: 1, updated_at: "2024-01-01T00:00:00Z" };
  it("prefers the higher lamport clock", () => {
    const remote = { ...base, device_id: "d2", lamport_clock: 2 };
    expect(resolveLWW(base, remote)).toBe(remote);
  });
  it("falls back to later updated_at on tie", () => {
    const remote = { ...base, lamport_clock: 1, updated_at: "2024-01-02T00:00:00Z" };
    expect(resolveLWW(base, remote)).toBe(remote);
  });
  it("breaks remaining ties by lexicographic device_id", () => {
    const remote = { ...base, lamport_clock: 1, updated_at: "2024-01-01T00:00:00Z", device_id: "d9" };
    expect(resolveLWW(base, remote)).toBe(remote);
    const remoteLose = { ...base, lamport_clock: 1, updated_at: "2024-01-01T00:00:00Z", device_id: "d0" };
    expect(resolveLWW(base, remoteLose)).toBe(base);
  });
});

describe("mergeStockQuantity", () => {
  it("sums base plus both deltas when deltas are present (CRDT)", () => {
    expect(mergeStockQuantity(10, 12, 10, -2, 2)).toBe(10);
    expect(mergeStockQuantity(5, 7, 5, -3, 4)).toBe(6);
  });
  it("falls back to remote when deltas are missing", () => {
    expect(mergeStockQuantity(5, 9, 5, undefined, undefined)).toBe(9);
  });
});

describe("toChange", () => {
  it("wraps a record into a sync change", () => {
    expect(toChange("sales", "create", { id: "s1" })).toEqual({
      table: "sales",
      operation: "create",
      record: { id: "s1" },
    });
  });
});

describe("sortChangesByClock", () => {
  it("sorts ascending by lamport clock then updated_at", () => {
    const changes = [
      toChange("t", "create", { id: "b", lamport_clock: 2, updated_at: "2024-01-02T00:00:00Z" }),
      toChange("t", "create", { id: "a", lamport_clock: 1, updated_at: "2024-01-01T00:00:00Z" }),
      toChange("t", "create", { id: "c", lamport_clock: 1, updated_at: "2024-01-01T00:00:00Z" }),
    ];
    const sorted = sortChangesByClock(changes);
    expect(sorted.map((c) => c.record.id)).toEqual(["a", "c", "b"]);
  });
  it("does not mutate the input array", () => {
    const changes = [toChange("t", "create", { id: "a", lamport_clock: 1 })];
    sortChangesByClock(changes);
    expect(changes[0].record.id).toBe("a");
  });
});

describe("nextRetryDelay", () => {
  it("grows exponentially and caps at 60s", () => {
    expect(nextRetryDelay(0)).toBe(1000);
    expect(nextRetryDelay(1)).toBe(2000);
    expect(nextRetryDelay(2)).toBe(4000);
    expect(nextRetryDelay(10)).toBe(60000);
    expect(nextRetryDelay(100)).toBe(60000);
  });
});

describe("reconcileIncoming", () => {
  it("applies records not present locally", () => {
    const local = new Map();
    const incoming = [toChange("t", "create", { id: "new", lamport_clock: 1, updated_at: "t1" })];
    const { toApply } = reconcileIncoming(local, incoming);
    expect(toApply).toHaveLength(1);
  });
  it("applies remote when it wins LWW", () => {
    const local = new Map([
      [
        "x",
        { id: "x", device_id: "d1", lamport_clock: 1, updated_at: "t1" },
      ],
    ]);
    const remote = { id: "x", device_id: "d2", lamport_clock: 2, updated_at: "t2" };
    const { toApply } = reconcileIncoming(local, [toChange("t", "update", remote)]);
    expect(toApply[0].record).toBe(remote);
  });
  it("records conflicts when timestamps/clocks differ", () => {
    const local = new Map([
      [
        "x",
        { id: "x", device_id: "d1", lamport_clock: 1, updated_at: "t1" },
      ],
    ]);
    const remote = { id: "x", device_id: "d2", lamport_clock: 2, updated_at: "t2" };
    const { conflicts } = reconcileIncoming(local, [toChange("t", "update", remote)]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].winner).toBe(remote);
  });
});

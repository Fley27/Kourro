import { describe, it, expect } from "@jest/globals";
import {
  itemFactor,
  minItemFactor,
  itemsForProduct,
  toCanonicalQty,
  fromCanonicalQty,
  countInUnit,
  biggestUnitDisplay,
  itemUnitCosts,
  previewBatchUnitCost,
  consumeFifoMovements,
} from "../index";

const productId = "prod-rice";
const items = [
  { id: "item-pcs", product_id: productId, name: "pcs", ref_item_id: null, ratio: null, is_deleted: false },
  { id: "item-bag", product_id: productId, name: "bag", ref_item_id: "item-pcs", ratio: 12, is_deleted: false },
  { id: "item-sack", product_id: productId, name: "sack", ref_item_id: "item-bag", ratio: 20, is_deleted: false },
];

describe("itemFactor / minItemFactor", () => {
  it("computes cumulative factors up the ref chain", () => {
    expect(itemFactor(items, "item-pcs")).toBe(1);
    expect(itemFactor(items, "item-bag")).toBe(12);
    expect(itemFactor(items, "item-sack")).toBe(240);
  });
  it("returns 0 for unknown item and for broken ratio", () => {
    expect(itemFactor(items, "nope")).toBe(0);
    expect(
      itemFactor([{ id: "a", product_id: "p", name: "a", ref_item_id: "b", ratio: 0, is_deleted: false }], "a")
    ).toBe(0);
  });
  it("minItemFactor is the canonical divisor", () => {
    expect(minItemFactor(items, productId)).toBe(1);
    expect(minItemFactor(items, "unknown")).toBe(1);
  });
});

describe("canonical quantity conversion", () => {
  it("toCanonicalQty converts item units to canonical units", () => {
    expect(toCanonicalQty(items, productId, "item-bag", 3)).toBe(36);
    expect(toCanonicalQty(items, productId, "item-sack", 1)).toBe(240);
    expect(toCanonicalQty(items, productId, "item-pcs", 7)).toBe(7);
  });
  it("fromCanonicalQty converts canonical units back to item units", () => {
    expect(fromCanonicalQty(items, productId, "item-bag", 36)).toBe(3);
    expect(fromCanonicalQty(items, productId, "item-sack", 240)).toBe(1);
  });
  it("countInUnit floors sellable counts", () => {
    expect(countInUnit(items, productId, "item-sack", 240)).toBe(1);
    expect(countInUnit(items, productId, "item-sack", 479)).toBe(1);
    expect(countInUnit(items, productId, "item-bag", 13)).toBe(1);
  });
  it("biggestUnitDisplay picks the largest container (sack), flooring the count", () => {
    expect(biggestUnitDisplay(items, productId, 240)).toEqual({ count: 1, unit: "sack" });
    expect(biggestUnitDisplay(items, productId, 12)).toEqual({ count: 0, unit: "sack" });
    expect(biggestUnitDisplay(items, productId, 7)).toEqual({ count: 0, unit: "sack" });
    expect(biggestUnitDisplay(items, "unknown", 5)).toEqual({ count: 5, unit: "pcs" });
  });
});

describe("costs", () => {
  it("itemUnitCosts averages received batches and prefers newest pending", () => {
    const batches = [
      { id: "b1", item_id: "i1", status: "received", quantity: 10, total_paid: 20, created_at: "2024-01-01", date: "2024-01-01", is_deleted: false },
      { id: "b2", item_id: "i1", status: "received", quantity: 10, total_paid: 40, created_at: "2024-01-05", date: "2024-01-05", is_deleted: false },
      { id: "b3", item_id: "i2", status: "pending", quantity: 5, total_paid: 45, created_at: "2024-01-10", date: "2024-01-10", is_deleted: false },
    ];
    const costs = itemUnitCosts(batches);
    // avg of received i1: (20+40)/(10+10) = 3
    expect(costs.get("i1")).toBe(3);
    // newest pending overrides for i2
    expect(costs.get("i2")).toBe(9);
    expect(costs.get("missing")).toBeUndefined();
  });
  it("skips deleted / non-received batches", () => {
    const batches = [
      { id: "b1", item_id: "i1", status: "received", quantity: 10, total_paid: 20, created_at: "d1", date: "d1", is_deleted: false },
      { id: "b2", item_id: "i1", status: "received", quantity: 10, total_paid: 40, created_at: "d2", date: "d2", is_deleted: true },
      { id: "b3", item_id: "i2", status: "denied", quantity: 10, total_paid: 990, created_at: "d3", date: "d3", is_deleted: false },
    ];
    expect(itemUnitCosts(batches).get("i1")).toBe(2);
    expect(itemUnitCosts(batches).get("i2")).toBeUndefined();
  });
});

describe("previewBatchUnitCost", () => {
  it("divides total paid by quantity", () => {
    expect(previewBatchUnitCost(10, 100)).toBe(10);
    expect(previewBatchUnitCost(4, 30)).toBe(7.5);
  });
  it("returns 0 for non-positive quantity", () => {
    expect(previewBatchUnitCost(0, 100)).toBe(0);
    expect(previewBatchUnitCost(-3, 100)).toBe(0);
  });
});

describe("consumeFifoMovements", () => {
  it("consumes oldest movements first and returns remaining to sell", () => {
    const movements = [
      { id: "m1", remaining_qty: 5, quantity: 5, unit_cost: 2, allocated_transport: 0 },
      { id: "m2", remaining_qty: 5, quantity: 5, unit_cost: 4, allocated_transport: 0 },
    ];
    const res = consumeFifoMovements(movements, 7);
    expect(res.consumedCost).toBe(5 * 2 + 2 * 4);
    expect(res.remainingToSell).toBe(0);
    expect(res.updates).toEqual([
      { id: "m1", remaining_qty: 0 },
      { id: "m2", remaining_qty: 3 },
    ]);
  });
  it("reports remainingToSell when stock runs out", () => {
    const movements = [{ id: "m1", remaining_qty: 3, quantity: 3, unit_cost: 2, allocated_transport: 0 }];
    const res = consumeFifoMovements(movements, 10);
    expect(res.consumedCost).toBe(6);
    expect(res.remainingToSell).toBe(7);
  });
  it("includes per-unit transport share in cost", () => {
    const movements = [{ id: "m1", remaining_qty: 10, quantity: 10, unit_cost: 5, allocated_transport: 10 }];
    // unit cost with transport = 5 + 10/10 = 6 ; consume 2 -> 12
    const res = consumeFifoMovements(movements, 2);
    expect(res.consumedCost).toBe(12);
  });
});

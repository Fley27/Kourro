import { describe, it, expect } from "@jest/globals";
import {
  isSubscriptionWritable,
  isSubscriptionBlockedWrite,
  SUBSCRIPTION_ALWAYS_WRITABLE,
  CLOSE_OUT_TABLES,
  CLOSE_OUT_STATUSES,
} from "../index";

const oneHour = 60 * 60 * 1000;
const oneDay = 24 * 60 * 60 * 1000;
const future = (ms = Date.now() + 30 * oneDay) => new Date(ms).toISOString();
const past = (ms = Date.now() - 30 * oneDay) => new Date(ms).toISOString();

describe("isSubscriptionWritable", () => {
  it("returns false when there is no subscription row", () => {
    expect(isSubscriptionWritable(null)).toBe(false);
    expect(isSubscriptionWritable(undefined)).toBe(false);
  });

  it("trial is writable while trial_ends_at is in the future", () => {
    expect(isSubscriptionWritable({ status: "trial", trial_ends_at: future() })).toBe(true);
    expect(isSubscriptionWritable({ status: "trial", trial_ends_at: null })).toBe(true);
    expect(isSubscriptionWritable({ status: "trial", trial_ends_at: "" })).toBe(true);
    expect(isSubscriptionWritable({ status: "trial", trial_ends_at: past() })).toBe(false);
    expect(isSubscriptionWritable({ status: "trial", trial_ends_at: "not-a-date" })).toBe(false);
  });

  it("active is writable while renews_at is in the future", () => {
    expect(isSubscriptionWritable({ status: "active", renews_at: future() })).toBe(true);
    expect(isSubscriptionWritable({ status: "active", renews_at: null })).toBe(true);
    expect(isSubscriptionWritable({ status: "active", renews_at: past() })).toBe(false);
  });

  it("paused / cancelled / unknown are not writable", () => {
    expect(isSubscriptionWritable({ status: "paused", renews_at: future() })).toBe(false);
    expect(isSubscriptionWritable({ status: "cancelled", renews_at: future() })).toBe(false);
    expect(isSubscriptionWritable({ status: "expired", renews_at: future() })).toBe(false);
  });

  it("uses a fixed clock when one is supplied", () => {
    const now = Date.now();
    expect(isSubscriptionWritable({ status: "trial", trial_ends_at: future(now + oneDay) }, now)).toBe(true);
    expect(isSubscriptionWritable({ status: "trial", trial_ends_at: future(now - oneDay) }, now)).toBe(false);
  });
});

describe("isSubscriptionBlockedWrite", () => {
  const rec = { id: "r1" };

  it("never blocks always-writable tables", () => {
    for (const t of SUBSCRIPTION_ALWAYS_WRITABLE) {
      expect(isSubscriptionBlockedWrite(t, "create", rec)).toBe(false);
      expect(isSubscriptionBlockedWrite(t, "delete", rec)).toBe(false);
    }
  });

  it("blocks creates, deletes, and non-close-out updates when not writable", () => {
    expect(isSubscriptionBlockedWrite("sales", "create", rec)).toBe(true);
    expect(isSubscriptionBlockedWrite("sales", "delete", rec)).toBe(true);
    expect(isSubscriptionBlockedWrite("products", "update", rec)).toBe(true);
  });

  it("allows close-out table updates that move to a terminal status", () => {
    expect(
      isSubscriptionBlockedWrite("shifts", "update", { ...rec, status: "closed" })
    ).toBe(false);
    expect(
      isSubscriptionBlockedWrite("orders", "update", { ...rec, status: "cancelled" })
    ).toBe(false);
    expect(isSubscriptionBlockedWrite("open_orders", "update", { ...rec, status: "completed" })).toBe(false);
  });

  it("still blocks close-out updates that do not carry a terminal status", () => {
    expect(isSubscriptionBlockedWrite("shifts", "update", { ...rec, status: "open" })).toBe(true);
    expect(isSubscriptionBlockedWrite("shifts", "update", { ...rec })).toBe(true);
  });

  it("CLOSE_OUT_TABLES and CLOSE_OUT_STATUSES are non-empty", () => {
    expect(CLOSE_OUT_TABLES.size).toBeGreaterThan(0);
    expect(CLOSE_OUT_STATUSES.size).toBeGreaterThan(0);
  });
});

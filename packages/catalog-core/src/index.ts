// Shared catalog math for both the mobile app and the web POS.
// Everything here is either a pure function over plain catalog rows, or a
// db-touching helper that takes its db handle + outbox/id callbacks as
// arguments (so each app supplies its own persistence layer).
//
// Sources: mobile-app/src/catalogModel.ts (chain math, cost derivation),
// mobile-app/src/analytics/metrics.ts (itemUnitCosts/quoteItemRates/
// chainItemCosts/itemCostsFor), mobile-app/src/db/index.ts
// (recomputeItemCosts), mobile-app/src/checkout.ts (FIFO cost consumption).

// ---- types ----

export type Item = {
  id: string; product_id: string; name: string;
  ref_item_id: string | null; ratio: number | null;
  cost?: number;
  sort_order?: number; created_at?: string; updated_at?: string;
  is_deleted?: number | boolean; dirty?: number;
};

export type BatchStatus = "pending" | "received" | "denied";

export type Batch = {
  id: string; item_id: string; supplier_id: string;
  store_id?: string | null;
  date: string; quantity: number; total_paid: number;
  delivery_ref?: string | null; transport_share?: number;
  status: BatchStatus;
  received_by?: string | null; received_at?: string | null;
  denied_by?: string | null; denied_at?: string | null;
  reason?: string | null; source?: string;
  created_at?: string; updated_at?: string;
  is_deleted?: number | boolean; dirty?: number;
};

export type SupplierCostRow = {
  product_id: string;
  supplier_id: string;
  item_id?: string | null;
  unit_id: string;
  cost: number;
  last_updated?: string | null;
  is_deleted?: number | boolean;
};

export type OutboxFn = (table: string, op: "create" | "update" | "delete", row: Record<string, unknown>) => Promise<void> | void;

// ---- item-chain math (pure) ----

export function itemsForProduct(items: Item[], productId: string): Item[] {
  return items.filter(i => i.product_id === productId && !i.is_deleted);
}

/** Reference (factor-1) item: no ref — the anchor all math starts from. */
export function baseItem(items: Item[]): Item | null {
  return items.find(i => !i.ref_item_id) ?? null;
}

/** Smallest item by cumulative factor — the canonical storage unit. */
export function smallestItem(items: Item[]): Item | null {
  let best: Item | null = null;
  let bestF = Infinity;
  for (const it of items) {
    if (it.is_deleted) continue;
    const f = itemFactor(items, it.id);
    if (f > 0 && f < bestF) {
      bestF = f;
      best = it;
    }
  }
  return best ?? baseItem(items);
}

export function itemFactor(allItems: Item[], itemId: string): number {
  let factor = 1;
  let cur = allItems.find(i => i.id === itemId);
  const seen = new Set<string>();
  while (cur?.ref_item_id) {
    if (seen.has(cur.id)) return 0; // cycle guard (should be impossible)
    seen.add(cur.id);
    const r = Number(cur.ratio) || 0;
    if (!(r > 0)) return 0;
    factor *= r;
    cur = allItems.find(i => i.id === cur!.ref_item_id);
  }
  return cur ? factor : 0;
}

/** Children (directly larger items) of an item, for lock/descendant walks. */
export function itemChildren(allItems: Item[], itemId: string): Item[] {
  return allItems.filter(i => i.ref_item_id === itemId && !i.is_deleted);
}

export function itemDescendants(allItems: Item[], itemId: string): Set<string> {
  const out = new Set<string>();
  const walk = (id: string) => {
    for (const c of itemChildren(allItems, id)) {
      if (!out.has(c.id)) {
        out.add(c.id);
        walk(c.id);
      }
    }
  };
  walk(itemId);
  return out;
}

/** Minimum cumulative factor across a product's items (canonical divisor). */
export function minItemFactor(allItems: Item[], productId: string): number {
  const items = itemsForProduct(allItems, productId);
  let m = Infinity;
  for (const it of items) {
    const f = itemFactor(allItems, it.id);
    if (f > 0 && f < m) m = f;
  }
  return m === Infinity ? 1 : m;
}

/** Item units → canonical (smallest-unit) storage counts. */
export function toCanonicalQty(
  allItems: Item[],
  productId: string,
  itemId: string,
  qty: number
): number {
  const f = itemFactor(allItems, itemId);
  const m = minItemFactor(allItems, productId);
  if (!(f > 0) || !(m > 0)) return 0;
  return Math.round(((Number(qty) || 0) * f) / m);
}

/** Canonical counts → counts in the given item's units (may fractionalize). */
export function fromCanonicalQty(
  allItems: Item[],
  productId: string,
  itemId: string,
  canonicalQty: number
): number {
  const f = itemFactor(allItems, itemId);
  const m = minItemFactor(allItems, productId);
  if (!(f > 0) || !(m > 0)) return 0;
  return (Number(canonicalQty) || 0) / (f / m);
}

/** Floored sellable/available count of an item from canonical stock. */
export function countInUnit(
  allItems: Item[],
  productId: string,
  itemId: string,
  canonicalQty: number
): number {
  const f = itemFactor(allItems, itemId);
  const m = minItemFactor(allItems, productId);
  if (!(f > 0) || !(m > 0)) return 0;
  return Math.floor((Number(canonicalQty) || 0) / (f / m) + 1e-9);
}

/**
 * Biggest-container display pairing for a canonical stock count: converted
 * count + that container's name, so every surface prints the same number
 * with the same unit ("199 Kès" — never the raw 4792 labeled Kès). Falls
 * back to the raw count with `fallbackUnit` when the chain is unknown or
 * broken (deleted items, bad ratios).
 */
export function biggestUnitDisplay(
  allItems: Item[],
  productId: string,
  canonicalQty: number,
  fallbackUnit = "pcs"
): { count: number; unit: string } {
  const qty = Number(canonicalQty) || 0;
  const chain = itemsForProduct(allItems, productId);
  const ranked = chain
    .map(it => ({ it, per: itemFactor(allItems, it.id) / minItemFactor(allItems, productId) }))
    .filter(x => x.per > 0)
    .sort((a, b) => b.per - a.per);
  const biggest = ranked[0] ?? null;
  if (!biggest) return { count: qty, unit: fallbackUnit };
  return { count: countInUnit(allItems, productId, biggest.it.id, qty), unit: biggest.it.name };
}

// ---- cost derivation (pure) ----

/**
 * Per-item average cost from batch history: received batches average out;
 * a NEWEST pending batch overrides the received history for its own item
 * (what you just entered is what everything chains from).
 */
export function itemUnitCosts(batches: Batch[]): Map<string, number> {
  const agg = new Map<string, { paid: number; qty: number }>();
  const pend = new Map<string, any>();
  const byRecency = (a: any, b: any) =>
    String(b.date ?? "").localeCompare(String(a.date ?? "")) ||
    String(b.created_at ?? "").localeCompare(String(a.created_at ?? ""));
  for (const b of batches as any[]) {
    if (!b || b.is_deleted) continue;
    const st = String(b.status ?? "");
    if (st !== "received" && st !== "pending") continue;
    const qty = Number(b.quantity ?? 0);
    if (!(qty > 0)) continue;
    const id = String(b.item_id);
    if (st === "pending") {
      const cur = pend.get(id);
      if (!cur || byRecency(cur, b) > 0) pend.set(id, b);
    } else {
      const g = agg.get(id) ?? { paid: 0, qty: 0 };
      g.paid += Number(b.total_paid ?? 0);
      g.qty += qty;
      agg.set(id, g);
    }
  }
  const out = new Map<string, number>();
  for (const [id, g] of agg) out.set(id, g.qty > 0 ? g.paid / g.qty : 0);
  for (const [id, b] of pend) {
    const rate = Number(b.total_paid ?? 0) / Number(b.quantity ?? 0);
    if (rate > 0) out.set(id, rate);
  }
  return out;
}

/** Latest supplier quote per item (product_supplier_costs). */
export function quoteItemRates(costRows: SupplierCostRow[]): Map<string, number> {
  const out = new Map<string, number>();
  const stamp = new Map<string, string>();
  for (const r of (costRows ?? []) as any[]) {
    if (!r || r.is_deleted) continue;
    const id = String(r?.item_id ?? r?.unit_id ?? "");
    if (!id) continue;
    const c = Number(r?.cost ?? 0);
    if (!(c > 0)) continue;
    const at = String(r?.last_updated ?? r?.updated_at ?? "");
    const cur = stamp.get(id);
    if (cur != null && at < cur) continue;
    stamp.set(id, at);
    out.set(id, c);
  }
  return out;
}

/**
 * Walk one product's item chain and price every container from the anchors:
 * a child is `ratio ×` its reference item. Each item resolves once, so
 * cycles and conflicting anchors cannot loop or overwrite a known cost.
 */
export function chainItemCosts(items: Item[], anchors: Map<string, number>): Map<string, number> {
  const out = new Map<string, number>();
  for (const [id, c] of anchors) if (Number(c) > 0) out.set(String(id), Number(c));
  const byId = new Map<string, Item>();
  const kids = new Map<string, Item[]>();
  for (const it of (items ?? []) as Item[]) {
    if (!it || it.is_deleted) continue;
    const id = String(it.id);
    byId.set(id, it);
    if (it.ref_item_id) {
      const pid = String(it.ref_item_id);
      const arr = kids.get(pid) ?? [];
      arr.push(it);
      kids.set(pid, arr);
    }
  }
  const ratioOf = (it: Item): number => {
    const r = Number(it.ratio);
    return r > 0 && isFinite(r) ? r : 0;
  };
  const queue = [...out.keys()];
  while (queue.length) {
    const id = queue.shift() as string;
    const cost = out.get(id);
    if (cost == null) continue;
    const cur = byId.get(id);
    if (!cur) continue;
    for (const child of kids.get(id) ?? []) {
      const cid = String(child.id);
      if (out.has(cid)) continue;
      const r = ratioOf(child);
      if (!(r > 0)) continue;
      out.set(cid, cost * r);
      queue.push(cid);
    }
    const pid = cur.ref_item_id ? String(cur.ref_item_id) : "";
    if (pid && !out.has(pid) && byId.has(pid)) {
      const r = ratioOf(cur);
      if (!(r > 0)) continue;
      out.set(pid, cost / r);
      queue.push(pid);
    }
  }
  return out;
}

/** Spread successive cost sources over one product chain, strongest first. */
export function chainInLayers(items: Item[], layers: Map<string, number>[]): Map<string, number> {
  let acc = new Map<string, number>();
  for (const layer of layers) {
    const seeds = new Map(acc);
    for (const [id, c] of layer) {
      const v = Number(c);
      const key = String(id);
      if (v > 0 && !seeds.has(key)) seeds.set(key, v);
    }
    acc = chainItemCosts(items, seeds);
  }
  return acc;
}

/** Derived costs: batches, then supplier quotes, spread by the ratio chain. */
export function deriveItemCosts(
  items: Item[], batches: Batch[], costRows: SupplierCostRow[]
): Map<string, number> {
  return chainInLayers(items, [itemUnitCosts(batches), quoteItemRates(costRows)]);
}

/**
 * The cost map everything reads: batches, then supplier quotes, then a cost
 * the owner typed by hand (items.cost). A weaker source only fills what
 * stronger ones left unknown — a real purchase always beats a stale quote.
 */
export function itemCostsFor(
  items: Item[], batches: Batch[], costRows: SupplierCostRow[]
): Map<string, number> {
  const stored = new Map<string, number>();
  for (const it of (items ?? []) as any[]) {
    const v = Number(it?.cost ?? 0);
    if (v > 0) stored.set(String(it?.id ?? ""), v);
  }
  return chainInLayers(items, [itemUnitCosts(batches), quoteItemRates(costRows), stored]);
}

// ---- batch-derived product costs (pure, read path) ----

/**
 * Cost per anchor (factor-1) unit, from the newest batch (pending preferred
 * over received, newest first) across the product's items.
 */
export function currentBaseCost(
  allItems: Item[],
  batches: Batch[],
  productId: string
): number {
  const items = itemsForProduct(allItems, productId);
  const ids = new Set(items.map(i => i.id));
  const live = (batches as Batch[]).filter(b =>
    b && !b.is_deleted && ids.has(b.item_id) &&
    Number(b.quantity) > 0 && Number(b.total_paid) > 0
  );
  const byRecency = (a: Batch, b: Batch) =>
    String(b.date ?? "").localeCompare(String(a.date ?? "")) ||
    String(b.created_at ?? "").localeCompare(String(a.created_at ?? ""));
  const pend = live.filter(b => b.status === "pending").sort(byRecency);
  const pool = pend.length ? pend : live.filter(b => b.status === "received").sort(byRecency);
  const b = pool[0];
  if (!b) return 0;
  const f = itemFactor(allItems, b.item_id);
  if (!(f > 0)) return 0;
  return Math.max(0, Number(b.total_paid) / Number(b.quantity) / f);
}

/** Cost at a specific item level, derived from the base cost. */
export function costForItem(
  allItems: Item[],
  batches: Batch[],
  productId: string,
  itemId: string
): number {
  const base = currentBaseCost(allItems, batches, productId);
  if (!(base > 0)) return 0;
  const f = itemFactor(allItems, itemId);
  return f > 0 ? base * f : 0;
}

/**
 * Cost per CANONICAL (smallest-unit) count — for margin math against
 * canonical quantities (checkout freeze, stock value, coupon discount).
 */
export function currentCanonicalCost(
  allItems: Item[],
  batches: Batch[],
  productId: string
): number {
  const base = currentBaseCost(allItems, batches, productId);
  if (!(base > 0)) return 0;
  const m = minItemFactor(allItems, productId);
  return m > 0 ? base * Math.min(m, 1) : 0;
}

/** Cost-per-unit preview for a draft batch (display only, any status). */
export function previewBatchUnitCost(quantity: number, totalPaid: number): number {
  if (!(quantity > 0)) return 0;
  return Number(totalPaid) / Number(quantity);
}

// ---- FIFO cost consumption (sale freeze) ----

export type FifoMovement = {
  id: string;
  remaining_qty?: number | null;
  quantity?: number | null;
  unit_cost?: number | null;
  allocated_transport?: number | null;
};

/**
 * Walk FIFO stock movements oldest-first, consuming `baseQty` canonical
 * units and returning the cash cost consumed (unit_cost + per-unit transport
 * share per movement) plus the per-movement remaining_qty updates.
 * remainingToSell > 0 means stock ran out — the caller decides what that
 * means (cash sale, warning, etc.).
 */
export function consumeFifoMovements(
  movements: FifoMovement[],
  baseQty: number
): { consumedCost: number; remainingToSell: number; updates: { id: string; remaining_qty: number }[] } {
  let toSell = Number(baseQty) || 0;
  let consumedCost = 0;
  const updates: { id: string; remaining_qty: number }[] = [];
  for (const br of movements) {
    if (toSell <= 0) break;
    const rem = Number(br.remaining_qty ?? 0);
    if (!(rem > 0)) continue;
    const consume = Math.min(rem, toSell);
    const qty = Number(br.quantity ?? 0);
    const transport = Number(br.allocated_transport ?? 0);
    const unitCostWithTransport = qty > 0 && transport
      ? Number(br.unit_cost ?? 0) + transport / qty
      : Number(br.unit_cost ?? 0);
    consumedCost += consume * unitCostWithTransport;
    updates.push({ id: String(br.id), remaining_qty: rem - consume });
    toSell -= consume;
  }
  return { consumedCost, remainingToSell: toSell, updates };
}

// ---- db-touching helpers (app supplies db + outbox/id callbacks) ----

/**
 * Recompute persisted items.cost from the layered cost map and queue the
 * changed rows for sync. `productId` narrows to one product (receive path);
 * omit it to recompute the whole catalog (post-migration / import).
 */
export async function recomputeItemCosts(
  db: any,
  opts: { productId?: string; insertOutbox: OutboxFn }
): Promise<number> {
  const load = async (sql: string, args: any[] = []): Promise<any[]> => {
    try { return ((await db.getAllAsync(sql, args)) ?? []) as any[]; } catch { return []; }
  };
  const { productId, insertOutbox } = opts;
  const items = (await load(
    productId ? "SELECT * FROM items WHERE product_id = ?" : "SELECT * FROM items",
    productId ? [productId] : []
  )).filter((i: any) => i && !i.is_deleted);
  if (!items.length) return 0;
  const batches = (await load("SELECT * FROM batches")).filter((b: any) => b && !b.is_deleted);
  const costRows = (await load("SELECT * FROM product_supplier_costs")).filter((r: any) => r && !r.is_deleted);
  const costs = itemCostsFor(items as Item[], batches as Batch[], costRows as SupplierCostRow[]);
  const now = new Date().toISOString();
  let changed = 0;
  for (const it of items) {
    const next = Number(costs.get(String(it.id)) ?? 0) || 0;
    const prev = Number(it.cost ?? 0) || 0;
    if (Math.abs(next - prev) < 1e-9) continue;
    try {
      await db.runAsync("UPDATE items SET cost = ?, updated_at = ?, dirty = 1 WHERE id = ?", [next, now, String(it.id)]);
    } catch { continue; }
    changed++;
    // Full row: the sync appliers REPLACE from the payload, so a partial one
    // would blank the name/product on the other device.
    // `now + 1ms`: the caller may have just published this same row (name
    // edit), and equal updated_at loses the LWW tie — this row must win.
    try {
      await insertOutbox("items", "update", {
        id: String(it.id), product_id: String(it.product_id), name: String(it.name ?? ""),
        ref_item_id: it.ref_item_id ?? null, ratio: it.ratio ?? null,
        sort_order: Number(it.sort_order ?? 0), cost: next,
        created_at: it.created_at ?? now, updated_at: new Date(Date.now() + 1).toISOString(), is_deleted: false,
      });
    } catch {}
  }
  return changed;
}
/**
 * Upsert a supplier's quoted cost for an item (called from batch receive).
 * Prefer an item-keyed hit, then a legacy unit-keyed hit (pre-backfill row).
 */
export async function upsertSupplierCost(
  db: any,
  callbacks: { insertOutbox: OutboxFn; mintId: () => string },
  args: { productId: string; supplierId: string; itemId: string; cost: number }
): Promise<void> {
  const now = new Date().toISOString();
  const cost = Math.max(0, Number(args.cost) || 0);
  const existing = ((await db.getAllAsync(
    "SELECT * FROM product_supplier_costs WHERE product_id = ? AND supplier_id = ?",
    [args.productId, args.supplierId]
  ).catch(() => [])) ?? []) as any[];
  const hit = existing.find(r => String(r.item_id) === String(args.itemId))
    ?? existing.find(r => String(r.unit_id) === String(args.itemId));
  if (hit) {
    await db.runAsync(
      "UPDATE product_supplier_costs SET cost = ?, item_id = ?, last_updated = ?, updated_at = ?, dirty = 1 WHERE id = ?",
      [cost, args.itemId, now, now, String(hit.id)]
    );
    try {
      await callbacks.insertOutbox("product_supplier_costs", "update", {
        id: String(hit.id), cost, item_id: args.itemId, last_updated: now, updated_at: now, is_deleted: false,
      });
    } catch {}
    return;
  }
  const id = callbacks.mintId();
  const rec = {
    id, product_id: args.productId, supplier_id: args.supplierId,
    unit_id: args.itemId, item_id: args.itemId, cost,
    last_updated: now, updated_at: now, is_deleted: 0,
  };
  await db.runAsync(
    "INSERT OR REPLACE INTO product_supplier_costs (id, product_id, supplier_id, unit_id, item_id, cost, last_updated, updated_at, is_deleted, dirty) VALUES (?,?,?,?,?,?,?,?,?,?)",
    [rec.id, rec.product_id, rec.supplier_id, rec.unit_id, rec.item_id, rec.cost, rec.last_updated, rec.updated_at, 0, 1]
  );
  try {
    await callbacks.insertOutbox("product_supplier_costs", "create", { ...rec, is_deleted: false });
  } catch {}
}

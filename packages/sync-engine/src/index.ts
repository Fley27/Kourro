import type { SyncMeta, SyncChange, SyncOperation } from "@retail/shared-types";

// ── Vector clock / Lamport ──────────────────────────────
export type VectorClock = Record<string, number>; // device_id -> counter

export function incrementClock(clock: VectorClock, deviceId: string): VectorClock {
  return { ...clock, [deviceId]: (clock[deviceId] ?? 0) + 1 };
}

export function mergeClocks(a: VectorClock, b: VectorClock): VectorClock {
  const out: VectorClock = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = Math.max(out[k] ?? 0, v);
  return out;
}

export function compareClocks(a: VectorClock, b: VectorClock): "a_before_b" | "b_before_a" | "concurrent" | "equal" {
  let aGt = false, bGt = false;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    const av = a[k] ?? 0, bv = b[k] ?? 0;
    if (av > bv) aGt = true;
    if (bv > av) bGt = true;
  }
  if (!aGt && !bGt) return "equal";
  if (aGt && !bGt) return "a_before_b"; // a dominates b
  if (bGt && !aGt) return "b_before_a";
  return "concurrent";
}

// ── LWW (Last-Write-Wins) resolver ─────────────────────
export function resolveLWW<T extends SyncMeta>(local: T, remote: T): T {
  // Prefer higher lamport, then later updated_at, then lexicographically higher device_id as tiebreaker
  if (remote.lamport_clock !== local.lamport_clock) {
    return remote.lamport_clock > local.lamport_clock ? remote : local;
  }
  if (remote.updated_at !== local.updated_at) {
    return remote.updated_at > local.updated_at ? remote : local;
  }
  return (remote.device_id ?? "") > (local.device_id ?? "") ? remote : local;
}

// Stock needs special handling: concurrent sales should sum, not overwrite
export function mergeStockQuantity(local: number, remote: number, base: number, localDelta: number, remoteDelta: number): number {
  // CRDT counter: base + both deltas
  // If we don't have deltas, fall back to LWW
  if (typeof localDelta === "number" && typeof remoteDelta === "number") {
    return base + localDelta + remoteDelta;
  }
  return remote; // fallback handled by resolveLWW at record level
}

// ── Change log helpers ──────────────────────────────────
export function toChange<T extends SyncMeta>(table: string, op: SyncOperation, record: T): SyncChange<T> {
  return { table, operation: op, record };
}

export function sortChangesByClock(changes: SyncChange[]): SyncChange[] {
  return [...changes].sort((a, b) => {
    const ac = (a.record as SyncMeta).lamport_clock;
    const bc = (b.record as SyncMeta).lamport_clock;
    if (ac !== bc) return ac - bc;
    return (a.record as SyncMeta).updated_at.localeCompare((b.record as SyncMeta).updated_at);
  });
}

// ── Outbox (client-side) ───────────────────────────────
export interface OutboxEntry {
  id: string;
  table: string;
  operation: SyncOperation;
  payload: SyncMeta & Record<string, unknown>;
  attempts: number;
  created_at: string;
}

export function nextRetryDelay(attempts: number): number {
  // exponential backoff capped at 60s
  return Math.min(1000 * Math.pow(2, attempts), 60000);
}

// ── LAN P2P helpers ────────────────────────────────────
// Discovery payload advertised via mDNS
export interface PeerAdvertisement {
  device_id: string;
  store_id: string;
  device_name: string;
  port: number;
  version: number;
}

export interface LanSyncMessage {
  type: "hello" | "pull_request" | "push" | "ack";
  from: string;
  store_id: string;
  changes?: SyncChange[];
  vectorClock?: VectorClock;
  lastSyncedAt?: string | null;
}

// Merge incoming LAN changes into local store (caller applies to SQLite)
export function reconcileIncoming<T extends SyncMeta>(
  localById: Map<string, T>,
  incoming: SyncChange<T>[]
): { toApply: SyncChange<T>[]; conflicts: Array<{ local: T; remote: T; winner: T }> } {
  const toApply: SyncChange<T>[] = [];
  const conflicts: Array<{ local: T; remote: T; winner: T }> = [];

  for (const ch of incoming) {
    const id = (ch.record as SyncMeta).id;
    const local = localById.get(id);
    if (!local) {
      toApply.push(ch);
      continue;
    }
    const winner = resolveLWW(local, ch.record as T);
    if (winner === ch.record) {
      toApply.push(ch);
    }
    if (winner !== local || winner !== ch.record) {
      // actually winner is one of them; record conflict if concurrent
    }
    // If same id exists, record conflict for audit even if same winner
    if (local.updated_at !== (ch.record as SyncMeta).updated_at || local.lamport_clock !== (ch.record as SyncMeta).lamport_clock) {
      conflicts.push({ local, remote: ch.record as T, winner });
    }
  }
  return { toApply, conflicts };
}

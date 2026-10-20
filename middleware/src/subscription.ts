// Subscription write-gate (migration 029) — middleware pre-check.
//
// The authoritative enforcement is the Postgres trigger 029; this module is
// the FRIENDLY layer in front of it: a read-only org gets a per-row
// `error:subscription_expired` instead of a raw trigger message, and the
// client knows to keep those rows queued (no attempt burn) until renewal.
//
// Writability mirrors @fley27/shared-types isSubscriptionWritable (same rule
// the device and the trigger apply). Redis caches the answer for 60s so a
// register burst does not hammer the subscriptions table.
import { supabase, redis } from "./index.js";
import { isSubscriptionWritable } from "@fley27/shared-types";

const CACHE_TTL_SECONDS = 60;
const cacheKey = (orgId: string) => `sub:writable:${orgId}`;

/**
 * May the org write? No org, no subscription row, expired trial/renewal →
 * false (read-only). A transient failure fails OPEN: a blip must not lock
 * every register out of writing — the 029 trigger still refuses stray rows.
 */
export async function isOrgWritable(orgId: string | null): Promise<boolean> {
  if (!orgId) return false;
  try {
    const cached = await redis.get(cacheKey(orgId));
    if (cached != null) return cached === "1";
  } catch {}
  let writable: boolean;
  try {
    const { data, error } = await supabase
      .from("subscriptions")
      .select("status,trial_ends_at,renews_at")
      .eq("organization_id", orgId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    writable = isSubscriptionWritable(data ?? null);
  } catch {
    return true;
  }
  try {
    await redis.set(cacheKey(orgId), writable ? "1" : "0", "EX", CACHE_TTL_SECONDS);
  } catch {}
  return writable;
}

/** Drop the cache entry after a manual plan change (admin tooling / renewal). */
export async function invalidateOrgWritableCache(orgId: string | null): Promise<void> {
  if (!orgId) return;
  try {
    await redis.del(cacheKey(orgId));
  } catch {}
}

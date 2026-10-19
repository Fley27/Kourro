/**
 * Response serialization: snake_case DB rows become camelCase JSON so the
 * client only ever sees one naming convention.
 *
 * Keys inside `metadata` / `features` are opaque data (not column names) and
 * are left untouched.
 */
const SKIPPED_SUBTREES = new Set(["metadata", "features"]);

function camelizeKey(key: string): string {
  return key.includes("_") ? key.replace(/_([a-z])/g, (_m, c: string) => c.toUpperCase()) : key;
}

export function camelize<T>(value: T, skip = false): T {
  if (Array.isArray(value)) {
    return value.map((item) => camelize(item, skip)) as unknown as T;
  }
  if (value instanceof Date) return value;
  if (value && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(source)) {
      const keepAsIs = skip || SKIPPED_SUBTREES.has(key);
      out[keepAsIs ? key : camelizeKey(key)] = camelize(child, keepAsIs);
    }
    return out as unknown as T;
  }
  return value;
}

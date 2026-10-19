// Keep IndexedDB durable: without a persist() grant the browser may evict
// the local database under storage pressure — on an offline-first POS that
// means losing unsynced sales.
export function installStoragePersistence(): void {
  try {
    const storage = (navigator.storage ?? null) as
      | (StorageManager & { persist?: () => Promise<boolean> })
      | null;
    if (storage && typeof storage.persist === "function") {
      void storage.persist().catch(() => {});
    }
  } catch {
    /* storage persistence is best-effort */
  }
}

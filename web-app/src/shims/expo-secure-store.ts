// expo-secure-store → localStorage.
//
// Desktop web has no Keychain/Keystore equivalent available to a PWA; the
// session token is stored under a namespaced localStorage key. This matches
// what supabase-js itself does on web (localStorage) — the persistence
// semantics the shared auth code relies on (survive reloads, per-origin
// isolation) hold, without the OS-level hardening native gets.
const PREFIX = "jesyon.secure.";

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    // Private mode / blocked storage.
    return null;
  }
}

export async function getItemAsync(key: string): Promise<string | null> {
  return storage()?.getItem(PREFIX + key) ?? null;
}

export async function setItemAsync(key: string, value: string): Promise<void> {
  storage()?.setItem(PREFIX + key, value);
}

export async function deleteItemAsync(key: string): Promise<void> {
  storage()?.removeItem(PREFIX + key);
}

export function getItem(key: string): string | null {
  return storage()?.getItem(PREFIX + key) ?? null;
}

export function setItem(key: string, value: string): void {
  storage()?.setItem(PREFIX + key, value);
}

export function deleteItem(key: string): void {
  storage()?.removeItem(PREFIX + key);
}

export async function isAvailableAsync(): Promise<boolean> {
  return storage() !== null;
}

export function canUseBiometricAuthentication(): boolean {
  return false;
}

export function getItemSync(key: string): string | null {
  return getItem(key);
}

export function setItemSync(key: string, value: string): void {
  setItem(key, value);
}

export function deleteItemSync(key: string): void {
  deleteItem(key);
}

export default {
  getItemAsync,
  setItemAsync,
  deleteItemAsync,
  getItem,
  setItem,
  deleteItem,
  isAvailableAsync,
  canUseBiometricAuthentication,
};

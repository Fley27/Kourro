// expo-crypto → WebCrypto.
export function getRandomBytes(byteCount: number): Uint8Array {
  const bytes = new Uint8Array(byteCount);
  crypto.getRandomValues(bytes);
  return bytes;
}

export async function getRandomBytesAsync(byteCount: number): Promise<Uint8Array> {
  return getRandomBytes(byteCount);
}

export function randomUUID(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = getRandomBytes(16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export const CryptoDigestAlgorithm = {
  MD2: "MD2",
  MD4: "MD4",
  MD5: "MD5",
  SHA1: "SHA-1",
  SHA256: "SHA-256",
  SHA384: "SHA-384",
  SHA512: "SHA-512",
} as const;

export const CryptoEncoding = { HEX: "hex", BASE64: "base64" } as const;

async function subtleDigest(
  algorithm: string,
  data: Uint8Array | ArrayBuffer | string
): Promise<ArrayBuffer> {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  return crypto.subtle.digest(algorithm, bytes as BufferSource);
}

export async function digest(
  algorithm: string,
  data: Uint8Array | ArrayBuffer | string
): Promise<ArrayBuffer> {
  return subtleDigest(algorithm, data);
}

export async function digestStringAsync(
  algorithm: string,
  data: string,
  options?: { encoding?: string }
): Promise<string> {
  const digestResult = await subtleDigest(algorithm, data);
  const bytes = new Uint8Array(digestResult);
  if (options?.encoding === "base64") {
    let binary = "";
    bytes.forEach((b) => {
      binary += String.fromCharCode(b);
    });
    return btoa(binary);
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function getRandomValues<T extends ArrayBufferView>(typedArray: T): T {
  return crypto.getRandomValues(typedArray);
}

export default {
  getRandomBytes,
  getRandomBytesAsync,
  randomUUID,
  digest,
  digestStringAsync,
  CryptoDigestAlgorithm,
  CryptoEncoding,
};

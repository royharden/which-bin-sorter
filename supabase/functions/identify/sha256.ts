// sha256 hex helper for the function folder (PLAN.md 4.2, 4.5). Allowlisted for the browser bundle: pure TypeScript,
// WebCrypto only (`crypto.subtle` is a global in browsers, Deno and Node >= 20), no imports.

export function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) out += byte.toString(16).padStart(2, "0");
  return out;
}

/** sha256 of a UTF-8 string or raw bytes, as 64 lowercase hex characters. */
export async function sha256Hex(data: string | Uint8Array): Promise<string> {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : new Uint8Array(data);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return bytesToHex(new Uint8Array(digest));
}

export const SHA256_HEX = /^[0-9a-f]{64}$/;

export function isSha256Hex(value: unknown): value is string {
  return typeof value === "string" && SHA256_HEX.test(value);
}

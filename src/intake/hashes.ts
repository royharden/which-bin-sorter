import { sha256Hex } from "../core/hash.ts";

export interface ImageHashes {
  readonly source_sha256: string;
  readonly upload_sha256: string;
}

/** Original fingerprint is only a mock-selector hint. The edge recomputes the resized upload fingerprint. */
export async function imageHashes(source: Uint8Array, upload: Uint8Array): Promise<ImageHashes> {
  const [source_sha256, upload_sha256] = await Promise.all([sha256Hex(source), sha256Hex(upload)]);
  return { source_sha256, upload_sha256 };
}

export function bytesToBase64(bytes: Uint8Array): string {
  // Bounded chunks avoid spreading a 1.5 MB image into a function's argument list.
  let binary = "";
  for (let start = 0; start < bytes.length; start += 8192) {
    binary += String.fromCharCode(...bytes.subarray(start, start + 8192));
  }
  return btoa(binary);
}

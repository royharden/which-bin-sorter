// Server-authoritative upload checks (PLAN.md 4.7 image bounds). Server-only. Pure TypeScript, no imports.
// Strict base64 decode, JPEG magic bytes, and a JPEG marker walk that reads SOF0/SOF2 width/height without decoding
// pixels. Anything malformed, multi-frame or unsupported is rejected (-> `bad_image` before any reservation).

export interface JpegInfo {
  readonly width: number;
  readonly height: number;
  readonly frame: "SOF0" | "SOF2";
  readonly components: number;
}

export type JpegReject =
  | "not_jpeg"
  | "truncated"
  | "malformed"
  | "unsupported_frame"
  | "multi_frame"
  | "zero_dimension"
  | "unsupported_components"
  | "unsupported_precision";

export type JpegParse = { readonly ok: true; readonly info: JpegInfo } | { readonly ok: false; readonly reason: JpegReject };

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

/** Strict standard base64 (no whitespace, no URL alphabet, length multiple of 4). Null when invalid. */
export function decodeBase64(text: string): Uint8Array | null {
  if (text.length === 0 || text.length % 4 !== 0 || !BASE64.test(text)) return null;
  let binary: string;
  try {
    binary = atob(text);
  } catch {
    return null;
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/** Decoded size of a base64 string of this length (upper bound; exact for unpadded input). */
export function base64DecodedLength(length: number): number {
  return Math.floor((length * 3) / 4);
}

export function hasJpegMagic(bytes: Uint8Array): boolean {
  return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

function u16(bytes: Uint8Array, offset: number): number | null {
  const hi = bytes[offset];
  const lo = bytes[offset + 1];
  return hi === undefined || lo === undefined ? null : (hi << 8) | lo;
}

/** Markers that stand alone (no length field): TEM and RST0-7. SOI/EOI are handled explicitly. */
function isStandalone(marker: number): boolean {
  return marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7);
}

/** Start-of-frame markers: C0-CF except DHT (C4), JPG (C8) and DAC (CC). */
function isSof(marker: number): boolean {
  return marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
}

const MPF_ID = [0x4d, 0x50, 0x46, 0x00]; // "MPF\0" in an APP2 segment = multi-picture (MPO) file

function startsWithAt(bytes: Uint8Array, offset: number, expected: readonly number[]): boolean {
  return expected.every((value, index) => bytes[offset + index] === value);
}

/** Skips entropy-coded data after an SOS header; returns the offset of the next real marker's 0xFF, or -1. */
function skipEntropy(bytes: Uint8Array, from: number): number {
  for (let index = from; index < bytes.length - 1; index++) {
    if (bytes[index] !== 0xff) continue;
    const next = bytes[index + 1];
    if (next === undefined) return -1;
    if (next === 0x00 || (next >= 0xd0 && next <= 0xd7) || next === 0xff) continue; // stuffed byte, RST, fill
    return index;
  }
  return -1;
}

/**
 * Walks the JPEG marker stream from SOI to EOI. Accepts exactly one SOF0 (baseline) or SOF2 (progressive) frame with
 * 8-bit precision and 1 or 3 components. Rejects other SOF types, a second frame, an MPF (multi-picture) segment,
 * anything after EOI that starts another image, and truncation.
 */
export function parseJpegHeader(bytes: Uint8Array): JpegParse {
  if (!hasJpegMagic(bytes)) return { ok: false, reason: "not_jpeg" };
  let offset = 2;
  let info: JpegInfo | null = null;
  let sawScan = false;
  for (;;) {
    if (offset >= bytes.length) return { ok: false, reason: "truncated" };
    if (bytes[offset] !== 0xff) return { ok: false, reason: "malformed" };
    // Skip fill bytes (any number of 0xFF before the marker code).
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset];
    if (marker === undefined) return { ok: false, reason: "truncated" };
    offset++;
    if (marker === 0xd9) break; // EOI
    if (marker === 0xd8 || marker === 0x00) return { ok: false, reason: "malformed" };
    if (isStandalone(marker)) continue;
    const length = u16(bytes, offset);
    if (length === null) return { ok: false, reason: "truncated" };
    if (length < 2) return { ok: false, reason: "malformed" };
    const segmentEnd = offset + length;
    if (segmentEnd > bytes.length) return { ok: false, reason: "truncated" };

    if (marker === 0xe2 && length >= 6 && startsWithAt(bytes, offset + 2, MPF_ID)) {
      return { ok: false, reason: "multi_frame" };
    }
    if (isSof(marker)) {
      if (info !== null) return { ok: false, reason: "multi_frame" };
      if (marker !== 0xc0 && marker !== 0xc2) return { ok: false, reason: "unsupported_frame" };
      if (length < 8) return { ok: false, reason: "malformed" };
      const precision = bytes[offset + 2];
      const height = u16(bytes, offset + 3);
      const width = u16(bytes, offset + 5);
      const components = bytes[offset + 7];
      if (precision === undefined || height === null || width === null || components === undefined) {
        return { ok: false, reason: "truncated" };
      }
      if (precision !== 8) return { ok: false, reason: "unsupported_precision" };
      if (width === 0 || height === 0) return { ok: false, reason: "zero_dimension" };
      if (components !== 1 && components !== 3) return { ok: false, reason: "unsupported_components" };
      if (length !== 8 + 3 * components) return { ok: false, reason: "malformed" };
      info = { width, height, frame: marker === 0xc0 ? "SOF0" : "SOF2", components };
    }
    offset = segmentEnd;
    if (marker === 0xda) {
      // SOS: a scan needs a frame first; then skip its entropy-coded data to the next marker.
      if (info === null) return { ok: false, reason: "malformed" };
      sawScan = true;
      const next = skipEntropy(bytes, offset);
      if (next === -1) return { ok: false, reason: "truncated" };
      offset = next;
    }
  }
  if (info === null || !sawScan) return { ok: false, reason: "malformed" };
  // After EOI: a second embedded image (SOI) means more than one frame.
  for (let index = offset; index < bytes.length - 1; index++) {
    if (bytes[index] === 0xff && bytes[index + 1] === 0xd8) return { ok: false, reason: "multi_frame" };
  }
  return { ok: true, info };
}

export interface UploadLimits {
  readonly upload_cap_bytes: number;
  readonly max_dimension: number;
}

export type UploadCheck =
  | { readonly ok: true; readonly bytes: Uint8Array; readonly info: JpegInfo }
  | { readonly ok: false; readonly reason: JpegReject | "bad_base64" | "too_large" | "too_many_pixels" };

/** Decode + size + JPEG header + dimension bound, in that order. Every failure maps to `bad_image`. */
export function checkUpload(imageB64: string, limits: UploadLimits): UploadCheck {
  if (base64DecodedLength(imageB64.length) > limits.upload_cap_bytes + 2) return { ok: false, reason: "too_large" };
  const bytes = decodeBase64(imageB64);
  if (bytes === null) return { ok: false, reason: "bad_base64" };
  if (bytes.length > limits.upload_cap_bytes) return { ok: false, reason: "too_large" };
  const parsed = parseJpegHeader(bytes);
  if (!parsed.ok) return { ok: false, reason: parsed.reason };
  if (parsed.info.width > limits.max_dimension || parsed.info.height > limits.max_dimension) {
    return { ok: false, reason: "too_many_pixels" };
  }
  return { ok: true, bytes, info: parsed.info };
}

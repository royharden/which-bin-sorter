import { hasExifApp1 } from "../../src/intake/reencode.ts";
/** Script-owned header guard: scripts cannot import the server-only imageHeader module. */
export function preparedJpegDimensions(bytes: Uint8Array): { width: number; height: number } {
  if (bytes.length > 1572864 || bytes[0] !== 255 || bytes[1] !== 216 || hasExifApp1(bytes)) throw new Error("normalized JPEG without APP1 required");
  let at = 2, frame: { width: number; height: number } | null = null, scan = false;
  const word = (i: number): number => { const a = bytes[i], b = bytes[i + 1]; if (a === undefined || b === undefined) throw new Error("truncated JPEG"); return a * 256 + b; };
  while (at < bytes.length) {
    if (bytes[at++] !== 255) throw new Error("malformed JPEG");
    while (bytes[at] === 255) at++;
    const marker = bytes[at++];
    if (marker === undefined) throw new Error("truncated JPEG");
    if (marker === 217) {
      if (!frame || !scan || at !== bytes.length) throw new Error("JPEG frame/scan/trailing data");
      return frame;
    }
    if (marker === 216 || marker === 0) throw new Error("unexpected JPEG marker");
    if (marker === 1 || (marker >= 208 && marker <= 215)) continue;
    const length = word(at), end = at + length;
    if (length < 2 || end > bytes.length) throw new Error("JPEG segment length");
    if (marker >= 192 && marker <= 207 && ![196, 200, 204].includes(marker)) {
      if (frame || ![192, 194].includes(marker) || bytes[at + 2] !== 8) throw new Error("unsupported JPEG frame");
      const height = word(at + 3), width = word(at + 5), components = bytes[at + 7];
      if (!width || !height || width > 1024 || height > 1024 || (components !== 1 && components !== 3) || length !== 8 + 3 * components) throw new Error("JPEG dimensions/components");
      frame = { width, height };
    }
    if (marker === 226 && bytes[at + 2] === 77 && bytes[at + 3] === 80 && bytes[at + 4] === 70 && bytes[at + 5] === 0) throw new Error("multi-picture JPEG");
    at = end;
    if (marker === 218) {
      if (!frame) throw new Error("JPEG scan before frame");
      scan = true;
      while (at < bytes.length - 1) {
        if (bytes[at] === 255 && bytes[at + 1] !== 0 && bytes[at + 1] !== 255 && !((bytes[at + 1] ?? 0) >= 208 && (bytes[at + 1] ?? 0) <= 215)) break;
        at++;
      }
    }
  }
  throw new Error("truncated JPEG");
}

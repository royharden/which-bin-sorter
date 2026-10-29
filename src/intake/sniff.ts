export const ORIGINAL_CAP_BYTES = 5 * 1024 * 1024;
export type ImageMime = "image/jpeg" | "image/png" | "image/webp";

export class IntakeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IntakeError";
  }
}

export function sniffImage(bytes: Uint8Array): ImageMime | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if ([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((byte, i) => bytes[i] === byte)) return "image/png";
  const ascii = (start: number, word: string): boolean => [...word].every((char, i) => bytes[start + i] === char.charCodeAt(0));
  if (bytes.length >= 12 && ascii(0, "RIFF") && ascii(8, "WEBP")) return "image/webp";
  return null;
}

/** Bytes and declared MIME must agree. An absent declaration may use the signature; an incorrect one may not. */
export function validateOriginal(bytes: Uint8Array, declaredMime: string): ImageMime {
  if (bytes.length === 0) throw new IntakeError("This photo is empty. Try another photo.");
  if (bytes.length > ORIGINAL_CAP_BYTES) throw new IntakeError("Choose a photo smaller than 5 MB.");
  const mime = sniffImage(bytes);
  if (mime === null) throw new IntakeError("Use JPEG/PNG or WebP. HEIC is not supported; export it as JPEG/PNG.");
  if (declaredMime !== "" && declaredMime.toLowerCase() !== mime) {
    throw new IntakeError("The photo type does not match its contents. Export it as JPEG/PNG and try again.");
  }
  return mime;
}

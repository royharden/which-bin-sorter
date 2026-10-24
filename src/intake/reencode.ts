import { PREPROCESSING_VERSION } from "../../supabase/functions/identify/visionSchema.ts";
import { imageHashes, bytesToBase64 } from "./hashes.ts";
import type { ImageHashes } from "./hashes.ts";
import { IntakeError, ORIGINAL_CAP_BYTES, sniffImage, validateOriginal } from "./sniff.ts";

export { PREPROCESSING_VERSION };
export const MAX_DIMENSION = 1024;
export const MAX_DECODED_PIXELS = 20_000_000;
export const UPLOAD_CAP_BYTES = 1_572_864;

export interface DecodedImage {
  readonly width: number;
  readonly height: number;
  encode(width: number, height: number, quality: number): Promise<Blob>;
  close(): void;
}
export interface ImageEncoder {
  decode(blob: Blob): Promise<DecodedImage>;
}
export interface PreparedImage extends ImageHashes {
  readonly blob: Blob;
  readonly bytes: Uint8Array;
  readonly image_b64: string;
  readonly width: number;
  readonly height: number;
  readonly preprocessing_version: typeof PREPROCESSING_VERSION;
}

/** APP1 marker scan, including segments between progressive scans. Reject all APP1, including EXIF/XMP. */
export function hasExifApp1(bytes: Uint8Array): boolean {
  if (sniffImage(bytes) !== "image/jpeg") return false;
  let offset = 2;
  while (offset < bytes.length) {
    if (bytes[offset] !== 0xff) { offset++; continue; }
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    if (marker === undefined || marker === 0xd9) break;
    if (marker === 0xe1) return true;
    if (marker === 0x00 || marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    const hi = bytes[offset];
    const lo = bytes[offset + 1];
    if (hi === undefined || lo === undefined) break;
    const length = hi * 256 + lo;
    if (length < 2) break;
    offset += length;
  }
  return false;
}

export function resizedDimensions(width: number, height: number): { width: number; height: number } {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 || width * height > MAX_DECODED_PIXELS) {
    throw new IntakeError("Choose a photo with no more than 20 million pixels.");
  }
  const scale = Math.min(1, MAX_DIMENSION / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

function canvasBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob(
    (blob) => blob === null ? reject(new IntakeError("Could not prepare this photo. Try another JPEG/PNG.")) : resolve(blob),
    "image/jpeg", quality,
  ));
}

/** The browser redraws pixels into a fresh canvas; source metadata is never copied. */
export const browserImageEncoder: ImageEncoder = {
  async decode(blob) {
    let source: ImageBitmap | HTMLImageElement;
    let release: () => void;
    if (typeof createImageBitmap === "function") {
      source = await createImageBitmap(blob, { imageOrientation: "from-image" });
      const bitmap = source;
      release = () => bitmap.close();
    } else {
      const url = URL.createObjectURL(blob);
      const image = new Image();
      try {
        await new Promise<void>((resolve, reject) => {
          image.onload = () => resolve();
          image.onerror = () => reject(new IntakeError("Could not decode this photo. Use JPEG/PNG."));
          image.src = url;
        });
      } catch (error) {
        URL.revokeObjectURL(url);
        throw error;
      }
      source = image;
      release = () => URL.revokeObjectURL(url);
    }
    const width = source instanceof HTMLImageElement ? source.naturalWidth : source.width;
    const height = source instanceof HTMLImageElement ? source.naturalHeight : source.height;
    return {
      width, height, close: release,
      async encode(targetWidth, targetHeight, quality) {
        if (typeof OffscreenCanvas !== "undefined") {
          const canvas = new OffscreenCanvas(targetWidth, targetHeight);
          const context = canvas.getContext("2d");
          if (context === null) throw new IntakeError("Canvas is unavailable in this browser.");
          context.fillStyle = "#fff";
          context.fillRect(0, 0, targetWidth, targetHeight);
          context.drawImage(source, 0, 0, targetWidth, targetHeight);
          return canvas.convertToBlob({ type: "image/jpeg", quality });
        }
        const canvas = document.createElement("canvas");
        canvas.width = targetWidth;
        canvas.height = targetHeight;
        const context = canvas.getContext("2d");
        if (context === null) throw new IntakeError("Canvas is unavailable in this browser.");
        context.fillStyle = "#fff";
        context.fillRect(0, 0, targetWidth, targetHeight);
        context.drawImage(source, 0, 0, targetWidth, targetHeight);
        return canvasBlob(canvas, quality);
      },
    };
  },
};

export async function prepareImage(blob: Blob, encoder: ImageEncoder = browserImageEncoder): Promise<PreparedImage> {
  if (blob.size > ORIGINAL_CAP_BYTES) throw new IntakeError("Choose a photo smaller than 5 MB.");
  const original = new Uint8Array(await blob.arrayBuffer());
  const mime = validateOriginal(original, blob.type);
  let decoded: DecodedImage;
  try { decoded = await encoder.decode(new Blob([original], { type: mime })); }
  catch (error) { throw error instanceof IntakeError ? error : new IntakeError("Could not decode this photo. Use JPEG/PNG."); }
  try {
    const { width, height } = resizedDimensions(decoded.width, decoded.height);
    for (const quality of [0.86, 0.64]) {
      const output = await decoded.encode(width, height, quality);
      if (output.size > UPLOAD_CAP_BYTES) continue;
      const bytes = new Uint8Array(await output.arrayBuffer());
      if (output.type !== "image/jpeg" || sniffImage(bytes) !== "image/jpeg" || hasExifApp1(bytes)) {
        throw new IntakeError("Photo preparation failed the JPEG privacy check. Try another photo.");
      }
      return { blob: output, bytes, image_b64: bytesToBase64(bytes), width, height,
        preprocessing_version: PREPROCESSING_VERSION, ...await imageHashes(original, bytes) };
    }
    throw new IntakeError("Image too large, try another photo.");
  } finally { decoded.close(); }
}

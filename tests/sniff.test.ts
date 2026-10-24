import { describe, expect, it } from "vitest";
import { ORIGINAL_CAP_BYTES, sniffImage, validateOriginal } from "../src/intake/sniff.ts";
import { buildJpeg, PNG_MAGIC } from "./helpers/jpeg.ts";

const WEBP = Uint8Array.from([82,73,70,70,4,0,0,0,87,69,66,80]);
describe("photo intake signatures", () => {
  it.each([[buildJpeg(), "image/jpeg"], [PNG_MAGIC, "image/png"], [WEBP, "image/webp"]] as const)("accepts supported bytes only with consistent declared MIME", (bytes, mime) => {
    expect(sniffImage(bytes)).toBe(mime);
    expect(validateOriginal(bytes, mime)).toBe(mime);
    expect(validateOriginal(bytes, "")).toBe(mime);
    expect(() => validateOriginal(bytes, "image/gif")).toThrow("does not match");
  });
  it("rejects HEIC, corrupt signatures, empty photos and oversized originals", () => {
    expect(() => validateOriginal(new Uint8Array([0,0,0,24,102,116,121,112,104,101,105,99]), "image/heic")).toThrow("JPEG/PNG");
    expect(sniffImage(new Uint8Array([0xff,0xd8]))).toBeNull();
    expect(() => validateOriginal(new Uint8Array(), "")).toThrow("empty");
    expect(() => validateOriginal(new Uint8Array(ORIGINAL_CAP_BYTES + 1), "image/jpeg")).toThrow("5 MB");
  });
});

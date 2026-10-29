// PLAN.md 4.7 image bounds: strict base64, JPEG magic, SOF0/SOF2 dimensions without decoding, multi-frame and
// unsupported rejection, and the combined upload check used before any reservation.
import { describe, expect, it } from "vitest";
import {
  base64DecodedLength,
  checkUpload,
  decodeBase64,
  hasJpegMagic,
  parseJpegHeader,
} from "../supabase/functions/identify/imageHeader.ts";
import { RUNTIME_CONFIG } from "../supabase/functions/identify/serverConfig.ts";
import { PNG_MAGIC, buildJpeg, jpegOfSize, toBase64 } from "./helpers/jpeg.ts";

describe("decodeBase64 (strict)", () => {
  it("round-trips standard base64", () => {
    const bytes = Uint8Array.from([0, 1, 2, 250, 255]);
    expect(decodeBase64(toBase64(bytes))).toEqual(bytes);
  });

  it.each([
    ["empty", ""],
    ["length not a multiple of 4", "abc"],
    ["whitespace", "AAAA AAAA"],
    ["newline", "AAAA\nAAAA"],
    ["URL alphabet", "ab-_"],
    ["data URL prefix", "data:image/jpeg;base64,AAAA"],
    ["padding in the middle", "AA==AAAA"],
  ])("rejects %s", (_name, text) => {
    expect(decodeBase64(text)).toBeNull();
  });

  it("estimates the decoded length from the text length", () => {
    expect(base64DecodedLength(8)).toBe(6);
  });
});

describe("parseJpegHeader", () => {
  it("reads baseline SOF0 width and height", () => {
    expect(parseJpegHeader(buildJpeg({ width: 640, height: 480 }))).toEqual({
      ok: true,
      info: { width: 640, height: 480, frame: "SOF0", components: 3 },
    });
  });

  it("reads progressive SOF2 and greyscale", () => {
    const parsed = parseJpegHeader(buildJpeg({ width: 1024, height: 768, frame: 0xc2, components: 1 }));
    expect(parsed).toEqual({ ok: true, info: { width: 1024, height: 768, frame: "SOF2", components: 1 } });
  });

  it("skips APPn segments, including an EXIF APP1 that embeds a thumbnail's SOI/EOI", () => {
    const exif = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00, 0xff, 0xd8, 0xff, 0xd9];
    const parsed = parseJpegHeader(buildJpeg({ segments: [[0xe1, exif]] }));
    expect(parsed.ok).toBe(true);
  });

  it("parses dimensions above the bound (the bound is checked separately)", () => {
    const parsed = parseJpegHeader(buildJpeg({ width: 1025, height: 10 }));
    expect(parsed.ok && parsed.info.width).toBe(1025);
  });

  it.each<[string, Uint8Array, string]>([
    ["PNG bytes", PNG_MAGIC, "not_jpeg"],
    ["empty", new Uint8Array(0), "not_jpeg"],
    ["SOF1 extended sequential", buildJpeg({ frame: 0xc1 }), "unsupported_frame"],
    ["SOF3 lossless", buildJpeg({ frame: 0xc3 }), "unsupported_frame"],
    ["SOF9 arithmetic", buildJpeg({ frame: 0xc9 }), "unsupported_frame"],
    ["two frames", buildJpeg({ secondFrame: true }), "multi_frame"],
    ["a second image after EOI", buildJpeg({ trailing: [0xff, 0xd8, 0xff, 0xe0] }), "multi_frame"],
    ["an MPF (multi-picture) APP2 segment", buildJpeg({ segments: [[0xe2, [0x4d, 0x50, 0x46, 0x00, 0x49, 0x49]]] }), "multi_frame"],
    ["scan before frame", buildJpeg({ scanBeforeFrame: true }), "malformed"],
    ["no frame at all", buildJpeg({ noFrame: true }), "malformed"],
    ["zero height (DNL)", buildJpeg({ height: 0 }), "zero_dimension"],
    ["zero width", buildJpeg({ width: 0 }), "zero_dimension"],
    ["12-bit precision", buildJpeg({ precision: 12 }), "unsupported_precision"],
    ["CMYK (4 components)", buildJpeg({ components: 4 }), "unsupported_components"],
    ["missing EOI", buildJpeg({ omitEoi: true }), "truncated"],
  ])("rejects %s -> %s", (_name, bytes, reason) => {
    expect(parseJpegHeader(bytes)).toEqual({ ok: false, reason });
  });

  it("rejects truncation inside a segment", () => {
    const full = buildJpeg();
    expect(parseJpegHeader(full.slice(0, 12))).toEqual({ ok: false, reason: "truncated" });
  });

  it("checks the magic bytes", () => {
    expect(hasJpegMagic(buildJpeg())).toBe(true);
    expect(hasJpegMagic(PNG_MAGIC)).toBe(false);
  });
});

describe("checkUpload (server-authoritative bounds)", () => {
  const limits = RUNTIME_CONFIG;

  it("accepts a 1024 x 1024 baseline JPEG under 1.5 MB", () => {
    const result = checkUpload(toBase64(buildJpeg({ width: 1024, height: 1024 })), limits);
    expect(result.ok).toBe(true);
  });

  it("rejects more than 1024 px on either side", () => {
    expect(checkUpload(toBase64(buildJpeg({ width: 1025, height: 800 })), limits)).toEqual({
      ok: false,
      reason: "too_many_pixels",
    });
    expect(checkUpload(toBase64(buildJpeg({ width: 800, height: 1025 })), limits)).toEqual({
      ok: false,
      reason: "too_many_pixels",
    });
  });

  it("rejects a decoded upload over 1.5 MB (1572864 bytes), accepts exactly the cap", () => {
    expect(limits.upload_cap_bytes).toBe(1572864);
    expect(checkUpload(toBase64(jpegOfSize(limits.upload_cap_bytes)), limits).ok).toBe(true);
    expect(checkUpload(toBase64(jpegOfSize(limits.upload_cap_bytes + 1)), limits)).toEqual({ ok: false, reason: "too_large" });
  });

  it("rejects PNG (the client always re-encodes to JPEG) and bad base64", () => {
    expect(checkUpload(toBase64(PNG_MAGIC), limits)).toEqual({ ok: false, reason: "not_jpeg" });
    expect(checkUpload("not base64!", limits)).toEqual({ ok: false, reason: "bad_base64" });
  });
});

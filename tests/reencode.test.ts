import { describe, expect, it, vi } from "vitest";
import { hasExifApp1, MAX_DECODED_PIXELS, prepareImage, resizedDimensions, UPLOAD_CAP_BYTES } from "../src/intake/reencode.ts";
import type { DecodedImage, ImageEncoder } from "../src/intake/reencode.ts";
import { buildJpeg, jpegOfSize, PNG_MAGIC } from "./helpers/jpeg.ts";

function source(): Blob { return new Blob([PNG_MAGIC], { type: "image/png" }); }
function fixtureEncoder(width = 4000, height = 3000, outputs = [new Blob([buildJpeg({ width: 1024, height: 768 })], { type: "image/jpeg" })]) {
  const encode = vi.fn<DecodedImage["encode"]>().mockImplementation(() => Promise.resolve(outputs.shift() ?? new Blob()));
  const close = vi.fn();
  const decode = vi.fn<ImageEncoder["decode"]>().mockResolvedValue({ width, height, encode, close });
  return { encoder: { decode }, encode, close, decode };
}
describe("re-encode privacy and bounds (injected encoder; not a real browser proof)", () => {
  it("draws at bounded dimensions, retains distinct fingerprints, and always releases the decoder", async () => {
    const fixture = fixtureEncoder();
    const image = await prepareImage(source(), fixture.encoder);
    expect(fixture.encode).toHaveBeenCalledWith(1024, 768, 0.86);
    expect(image.width).toBe(1024);
    expect(image.height).toBe(768);
    expect(image.preprocessing_version).toBe("jpeg-1024-v1");
    expect(image.source_sha256).not.toBe(image.upload_sha256);
    expect(image.image_b64).not.toMatch(/^data:/);
    expect(hasExifApp1(image.bytes)).toBe(false);
    expect(fixture.close).toHaveBeenCalledTimes(1);
  });
  it("detects APP1 metadata in input and rejects any encoder that copies it", async () => {
    const gpsTagged = buildJpeg({ segments: [[0xe1, [69,120,105,102,0,0,71,80,83]]] });
    expect(hasExifApp1(gpsTagged)).toBe(true);
    expect(hasExifApp1(buildJpeg())).toBe(false);
    const fixture = fixtureEncoder(400, 300, [new Blob([gpsTagged], { type: "image/jpeg" })]);
    await expect(prepareImage(source(), fixture.encoder)).rejects.toThrow("privacy check");
    expect(fixture.close).toHaveBeenCalledTimes(1);
  });
  it("resizes portraits, never upscales, and rejects over 20 MP before encode/draw", async () => {
    expect(resizedDimensions(3000, 4000)).toEqual({ width: 768, height: 1024 });
    expect(resizedDimensions(80, 60)).toEqual({ width: 80, height: 60 });
    const fixture = fixtureEncoder(MAX_DECODED_PIXELS, 2);
    await expect(prepareImage(source(), fixture.encoder)).rejects.toThrow("20 million");
    expect(fixture.encode).not.toHaveBeenCalled();
    expect(fixture.close).toHaveBeenCalledTimes(1);
  });
  it("retries once at lower quality then rejects oversized output", async () => {
    const huge = new Blob([jpegOfSize(UPLOAD_CAP_BYTES + 1)], { type: "image/jpeg" });
    const fixture = fixtureEncoder(640, 480, [huge, huge]);
    await expect(prepareImage(source(), fixture.encoder)).rejects.toThrow("Image too large");
    expect(fixture.encode.mock.calls.map((call) => call[2])).toEqual([0.86, 0.64]);
    expect(fixture.close).toHaveBeenCalledTimes(1);
  });
  it("accepts a successful lower-quality retry and re-sniffs its bytes", async () => {
    const fixture = fixtureEncoder(640, 480, [new Blob([new Uint8Array(UPLOAD_CAP_BYTES + 1)]), new Blob([buildJpeg()], { type: "image/jpeg" })]);
    await expect(prepareImage(source(), fixture.encoder)).resolves.toHaveProperty("width", 640);
    expect(fixture.encode).toHaveBeenCalledTimes(2);
    const wrong = fixtureEncoder(640, 480, [new Blob([PNG_MAGIC], { type: "image/jpeg" })]);
    await expect(prepareImage(source(), wrong.encoder)).rejects.toThrow("privacy check");
  });
  it("does not decode a MIME mismatch and closes the decoder after encode failure", async () => {
    const fixture = fixtureEncoder();
    await expect(prepareImage(new Blob([PNG_MAGIC], { type: "image/jpeg" }), fixture.encoder)).rejects.toThrow("does not match");
    expect(fixture.decode).not.toHaveBeenCalled();
    fixture.encode.mockRejectedValue(new Error("encode failed"));
    await expect(prepareImage(source(), fixture.encoder)).rejects.toThrow("encode failed");
    expect(fixture.close).toHaveBeenCalledTimes(1);
  });
});

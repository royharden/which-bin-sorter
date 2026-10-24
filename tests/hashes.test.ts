import { describe, expect, it } from "vitest";
import { bytesToBase64, imageHashes } from "../src/intake/hashes.ts";

describe("source and upload fingerprints", () => {
  it("hashes the actual bytes separately using SHA-256", async () => {
    const abc = new TextEncoder().encode("abc");
    const hashes = await imageHashes(abc, new Uint8Array());
    expect(hashes.source_sha256).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(hashes.upload_sha256).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(await imageHashes(abc, abc)).toEqual({ source_sha256: hashes.source_sha256, upload_sha256: hashes.source_sha256 });
  });
  it("base64 encodes bytes without a data prefix, including across chunk boundaries", () => {
    const bytes = new Uint8Array(20_000).map((_value, index) => index % 256);
    expect(bytesToBase64(bytes)).toBe(Buffer.from(bytes).toString("base64"));
  });
});

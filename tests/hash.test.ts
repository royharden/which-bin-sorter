import { describe, expect, it } from "vitest";
import { canonicalJson, sha256Hex } from "../src/core/hash.ts";
import { computeRulesVersion, shortRulesVersion } from "../src/core/rulesVersion.ts";
import { rawFixture } from "./helpers/fixtureRules.ts";

describe("canonicalJson", () => {
  it("sorts keys at every depth, keeps array order, no whitespace", () => {
    expect(canonicalJson({ b: 1, a: { d: [3, 1, 2], c: "x" } })).toBe('{"a":{"c":"x","d":[3,1,2]},"b":1}');
  });

  it("encodes primitives like JSON and omits undefined members", () => {
    expect(canonicalJson(null)).toBe("null");
    expect(canonicalJson(true)).toBe("true");
    expect(canonicalJson("é\n")).toBe(JSON.stringify("é\n"));
    expect(canonicalJson({ a: undefined, b: 2 })).toBe('{"b":2}');
  });

  it("rejects non-finite numbers and non-JSON values", () => {
    expect(() => canonicalJson(Number.NaN)).toThrow();
    expect(() => canonicalJson({ a: Number.POSITIVE_INFINITY })).toThrow();
    expect(() => canonicalJson(() => 1)).toThrow();
  });
});

describe("sha256Hex", () => {
  it("matches the FIPS 180-2 test vector for 'abc'", async () => {
    expect(await sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("hashes bytes and the equivalent UTF-8 string identically", async () => {
    expect(await sha256Hex(new Uint8Array([0x61, 0x62, 0x63]))).toBe(await sha256Hex("abc"));
  });
});

describe("computeRulesVersion", () => {
  it("is 64 hex chars and independent of key order", async () => {
    const fixture = rawFixture();
    const reordered = Object.fromEntries(Object.entries(fixture).reverse());
    const a = await computeRulesVersion(fixture);
    const b = await computeRulesVersion(reordered);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(b).toBe(a);
    expect(shortRulesVersion(a)).toBe(a.slice(0, 12));
  });

  it("changes when any rule changes", async () => {
    const fixture = rawFixture();
    const before = await computeRulesVersion(fixture);
    const first = fixture.entries[0];
    if (first) first.prep_steps = [...first.prep_steps, "Changed."];
    expect(await computeRulesVersion(fixture)).not.toBe(before);
  });
});

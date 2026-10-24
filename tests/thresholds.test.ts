import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEFAULT_THRESHOLDS, parseThresholds } from "../src/core/thresholds.ts";

const configJson: unknown = JSON.parse(
  readFileSync(new URL("../config/thresholds.json", import.meta.url), "utf8"),
);

describe("thresholds", () => {
  it("config/thresholds.json is valid and labelled as untuned placeholder values", () => {
    const result = parseThresholds(configJson);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.t_low).toBe(0.8);
      expect(result.value.margin).toBe(0.1);
      expect(result.value.provenance).toMatch(/placeholder, not tuned/);
    }
  });

  it("DEFAULT_THRESHOLDS equals the config file", () => {
    expect(DEFAULT_THRESHOLDS).toEqual(configJson);
  });

  it("the demo pizza box confidence (0.86) clears t_low", () => {
    expect(0.86 >= DEFAULT_THRESHOLDS.t_low).toBe(true);
  });

  it.each<[string, unknown]>([
    ["not an object", 0.8],
    ["array", [0.8, 0.1]],
    ["t_low above 1", { t_low: 1.2, margin: 0.1, provenance: "x" }],
    ["t_low negative", { t_low: -0.1, margin: 0.1, provenance: "x" }],
    ["t_low as string", { t_low: "0.8", margin: 0.1, provenance: "x" }],
    ["margin of 1", { t_low: 0.8, margin: 1, provenance: "x" }],
    ["margin negative", { t_low: 0.8, margin: -0.01, provenance: "x" }],
    ["missing provenance", { t_low: 0.8, margin: 0.1 }],
    ["empty provenance", { t_low: 0.8, margin: 0.1, provenance: " " }],
    ["unknown key", { t_low: 0.8, margin: 0.1, provenance: "x", t_high: 0.95 }],
    ["missing t_low", { margin: 0.1, provenance: "x" }],
  ])("rejects %s", (_label, raw) => {
    const result = parseThresholds(raw);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.length).toBeGreaterThan(0);
  });

  it("accepts boundary values", () => {
    expect(parseThresholds({ t_low: 0, margin: 0, provenance: "x" }).ok).toBe(true);
    expect(parseThresholds({ t_low: 1, margin: 0.99, provenance: "x" }).ok).toBe(true);
  });
});

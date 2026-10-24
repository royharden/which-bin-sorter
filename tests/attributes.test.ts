import { describe, expect, it } from "vitest";
import {
  CLARIFY_OPTIONS,
  applyClarifyAnswer,
  changeItemAttributes,
  emptyAttributes,
  fromVision,
  hasUserAnswer,
  isExhausted,
} from "../src/core/attributes.ts";
import { ATTRIBUTE_ORDER } from "../src/core/rules.ts";

describe("attributes", () => {
  it("emptyAttributes: all six unknown with source none, in the fixed order", () => {
    const attrs = emptyAttributes();
    expect(Object.keys(attrs)).toEqual([...ATTRIBUTE_ORDER]);
    for (const attr of ATTRIBUTE_ORDER) expect(attrs[attr]).toEqual({ value: null, source: "none" });
  });

  it("fromVision: copies booleans, null and missing become null, everything tagged vision", () => {
    const attrs = fromVision({ food_soiled: true, has_lid: false, broken: null });
    expect(attrs.food_soiled).toEqual({ value: true, source: "vision" });
    expect(attrs.has_lid).toEqual({ value: false, source: "vision" });
    expect(attrs.broken).toEqual({ value: null, source: "vision" });
    expect(attrs.liquid_inside).toEqual({ value: null, source: "vision" });
  });

  it("fromVision: non-boolean junk is treated as cannot-tell", () => {
    const attrs = fromVision({ food_soiled: "yes" as unknown as boolean });
    expect(attrs.food_soiled).toEqual({ value: null, source: "vision" });
  });

  it("applyClarifyAnswer: yes / no / not sure", () => {
    const base = emptyAttributes();
    expect(applyClarifyAnswer(base, "food_soiled", "yes").food_soiled).toEqual({ value: true, source: "user" });
    expect(applyClarifyAnswer(base, "food_soiled", "no").food_soiled).toEqual({ value: false, source: "user" });
    const unsure = applyClarifyAnswer(base, "food_soiled", "not_sure");
    expect(unsure.food_soiled).toEqual({ value: null, source: "user" });
    expect(isExhausted(unsure.food_soiled)).toBe(true);
    expect(hasUserAnswer(unsure.food_soiled)).toBe(true);
  });

  it("applyClarifyAnswer is immutable and allows at most one answer per attribute", () => {
    const base = emptyAttributes();
    const once = applyClarifyAnswer(base, "has_lid", "yes");
    expect(base.has_lid).toEqual({ value: null, source: "none" });
    expect(() => applyClarifyAnswer(once, "has_lid", "no")).toThrow();
    expect(() => applyClarifyAnswer(once, "broken", "no")).not.toThrow();
  });

  it("a user answer can override a vision value that was null", () => {
    const vision = fromVision({ liquid_inside: null });
    expect(applyClarifyAnswer(vision, "liquid_inside", "no").liquid_inside).toEqual({ value: false, source: "user" });
  });

  it("vision null and none are not exhausted", () => {
    expect(isExhausted({ value: null, source: "vision" })).toBe(false);
    expect(isExhausted({ value: null, source: "none" })).toBe(false);
    expect(isExhausted({ value: false, source: "user" })).toBe(false);
  });

  it("changeItemAttributes clears user answers and vision values", () => {
    const before = applyClarifyAnswer(fromVision({ food_soiled: true, broken: true }), "has_lid", "yes");
    expect(before.has_lid.source).toBe("user");
    expect(before.food_soiled.value).toBe(true);
    const after = changeItemAttributes();
    for (const attr of ATTRIBUTE_ORDER) expect(after[attr]).toEqual({ value: null, source: "none" });
  });

  it("clarify options are Yes / No / Not sure", () => {
    expect(CLARIFY_OPTIONS).toEqual(["yes", "no", "not_sure"]);
  });
});

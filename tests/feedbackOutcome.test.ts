import { describe, expect, it } from "vitest";
import { serializeFeedbackOutcome } from "../src/core/feedbackOutcome.ts";
import { citeRule, urlFragment } from "../src/core/cited.ts";
import { resolve } from "../src/core/resolve.ts";
import type { ResolveInput } from "../src/core/resolve.ts";
import { emptyAttributes } from "../src/core/attributes.ts";
import { allRuleIds, ruleIdFor } from "../src/core/rules.ts";
import { TEST_RULES_VERSION, TEST_THRESHOLDS, entryById, fixtureRules } from "./helpers/fixtureRules.ts";

const rules = fixtureRules();

function selected(itemId: string): ResolveInput {
  return {
    mode: "selected",
    item_id: itemId,
    rules,
    rulesVersion: TEST_RULES_VERSION,
    thresholds: TEST_THRESHOLDS,
    attributes: emptyAttributes(),
  };
}

describe("serializeFeedbackOutcome", () => {
  it("copies an answer's bin, item and rule id", () => {
    const result = resolve(selected("cardboard_box"));
    expect(serializeFeedbackOutcome(result)).toEqual({
      type: "answer",
      item_id: "cardboard_box",
      bin: "recycling",
      rule_id: "cardboard_box",
    });
  });

  it("records an abstain's reason code (and item/rule when present), never a bin", () => {
    const paint = serializeFeedbackOutcome(resolve(selected("paint_tin")));
    expect(paint).toEqual({ type: "abstain", reason_code: "ask_council_rule", item_id: "paint_tin", rule_id: "paint_tin" });
    const unknown = serializeFeedbackOutcome(resolve(selected("not_in_table")));
    expect(unknown).toEqual({ type: "abstain", reason_code: "no_candidate" });
    expect("bin" in unknown).toBe(false);
  });

  it("records a clarify as the item only", () => {
    expect(serializeFeedbackOutcome(resolve(selected("aerosol_can")))).toEqual({ type: "clarify", item_id: "aerosol_can" });
  });
});

describe("cited", () => {
  it("builds url#fragment pointers per rule id", () => {
    const entry = entryById(rules, "glass_jar");
    expect(citeRule(entry, "v1", 2)).toMatchObject({
      rule_id: "glass_jar#2",
      url: "https://fixture-city.example.invalid/rules#glass_jar",
      fragment: "glass_jar",
      verified_on: "2026-10-24",
      rules_version: "v1",
    });
    expect(citeRule(entry, "v1").rule_id).toBe("glass_jar");
  });

  it("urlFragment returns empty when there is no fragment", () => {
    expect(urlFragment("https://council.example.org/waste")).toBe("");
    expect(urlFragment("https://council.example.org/waste#a-z")).toBe("a-z");
  });

  it("rule ids: entry id for unconditional entries, entry#index for conditions", () => {
    expect(ruleIdFor("pizza_box", 1)).toBe("pizza_box#1");
    expect(ruleIdFor("cardboard_box", null)).toBe("cardboard_box");
    const ids = allRuleIds(rules);
    expect(ids).toContain("pizza_box#0");
    expect(ids).toContain("pizza_box#1");
    expect(ids).toContain("cardboard_box");
    expect(ids).toContain("paint_tin");
    expect(ids).not.toContain("pizza_box");
    expect(new Set(ids).size).toBe(ids.length);
  });
});

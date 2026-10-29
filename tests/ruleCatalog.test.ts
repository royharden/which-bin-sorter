// PLAN.md 4.7 [R1-1]: ruleCatalog.ts mirrors rules/fixture-city.json (bin ids, entry ids, rule ids and each rule's
// bin) and src/core/reasons.ts (the seven reason codes) exactly.
import { describe, expect, it } from "vitest";
import {
  BIN_IDS,
  ENTRY_IDS,
  REASON_CODES as MIRRORED_REASON_CODES,
  RULE_BINS,
  isKnownBin,
  isKnownEntry,
  isKnownReason,
  isKnownRule,
  ruleBelongsTo,
} from "../supabase/functions/identify/ruleCatalog.ts";
import { REASON_CODES } from "../src/core/reasons.ts";
import { allRuleIds, ruleIdFor } from "../src/core/rules.ts";
import { fixtureRules } from "./helpers/fixtureRules.ts";

const rules = fixtureRules();

/** Rule id -> the bin it answers with, computed from the rules file (null = no bin). */
function ruleBinsFromRules(): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const entry of rules.entries) {
    if (entry.conditions.length === 0) out[ruleIdFor(entry.id, null)] = entry.bin;
    else entry.conditions.forEach((condition, index) => (out[ruleIdFor(entry.id, index)] = condition.bin ?? null));
  }
  return out;
}

describe("ruleCatalog parity", () => {
  it("BIN_IDS equals the rules file's bins", () => {
    expect([...BIN_IDS]).toEqual(rules.bins.map((bin) => bin.id));
  });

  it("ENTRY_IDS equals the rules file's entries, in file order", () => {
    expect([...ENTRY_IDS]).toEqual(rules.entries.map((entry) => entry.id));
  });

  it("RULE_BINS has exactly the rules file's rule ids", () => {
    expect(Object.keys(RULE_BINS).sort()).toEqual(allRuleIds(rules).sort());
  });

  it("RULE_BINS maps every rule id to the bin it answers with", () => {
    expect(RULE_BINS).toEqual(ruleBinsFromRules());
  });

  it("REASON_CODES equals the seven core reason codes, in order", () => {
    expect([...MIRRORED_REASON_CODES]).toEqual([...REASON_CODES]);
    expect(MIRRORED_REASON_CODES).toHaveLength(7);
  });
});

describe("ruleCatalog predicates", () => {
  it("known ids", () => {
    expect(isKnownEntry("pizza_box")).toBe(true);
    expect(isKnownEntry("none")).toBe(false);
    expect(isKnownBin("recycling")).toBe(true);
    expect(isKnownBin("compost")).toBe(false);
    expect(isKnownReason("ambiguous_bins")).toBe(true);
    expect(isKnownReason("other")).toBe(false);
    expect(isKnownRule("pizza_box#0")).toBe(true);
    expect(isKnownRule("pizza_box")).toBe(false);
    expect(isKnownRule("toString")).toBe(false);
    expect(isKnownRule(42)).toBe(false);
  });

  it("ruleBelongsTo matches the entry itself or entry#<n> only", () => {
    expect(ruleBelongsTo("pizza_box#1", "pizza_box")).toBe(true);
    expect(ruleBelongsTo("cardboard_box", "cardboard_box")).toBe(true);
    expect(ruleBelongsTo("pizza_box#1", "pizza")).toBe(false);
    expect(ruleBelongsTo("pizza_box#x", "pizza_box")).toBe(false);
  });
});

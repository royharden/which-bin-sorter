// M1 acceptance (c) + (d): resolver order (PLAN.md 4.4), answer / clarify / all 7 reason codes, re-resolve after
// clarify, Not-sure path, Change item clearing + selected mode, clarify attribute order, no question when known
// attributes already fix the outcome, instruction-only -> ask_council_rule, ambiguous_bins only when outcomes differ.
import { describe, expect, it } from "vitest";
import * as resolveModule from "../src/core/resolve.ts";
import { resolve } from "../src/core/resolve.ts";
import type { ImageQuality, ResolveInput, ResolveResult, VisionEvidence } from "../src/core/resolve.ts";
import {
  applyClarifyAnswer,
  changeItemAttributes,
  emptyAttributes,
  fromVision,
} from "../src/core/attributes.ts";
import type { ResolvedAttributes, VisionAttributeValues } from "../src/core/attributes.ts";
import { REASON_CODES } from "../src/core/reasons.ts";
import type { ReasonCode } from "../src/core/reasons.ts";
import type { RulesFile } from "../src/core/rules.ts";
import { TEST_RULES_VERSION, TEST_THRESHOLDS, entryById, fixtureRules, rawFixture } from "./helpers/fixtureRules.ts";

const rules = fixtureRules();

function vision(
  candidates: Array<[string, number]>,
  opts: { item_count?: number; image_quality?: ImageQuality } = {},
): VisionEvidence {
  return {
    item_count: opts.item_count ?? 1,
    candidates: candidates.map(([item_id, confidence]) => ({ item_id, confidence })),
    image_quality: opts.image_quality ?? "good",
  };
}

function visionInput(v: VisionEvidence, attrs: VisionAttributeValues = {}, rulesFile: RulesFile = rules): ResolveInput {
  return {
    mode: "vision",
    vision: v,
    rules: rulesFile,
    rulesVersion: TEST_RULES_VERSION,
    thresholds: TEST_THRESHOLDS,
    attributes: fromVision(attrs),
  };
}

function selectedInput(
  itemId: string,
  attributes: ResolvedAttributes = emptyAttributes(),
  rulesFile: RulesFile = rules,
): ResolveInput {
  return {
    mode: "selected",
    item_id: itemId,
    rules: rulesFile,
    rulesVersion: TEST_RULES_VERSION,
    thresholds: TEST_THRESHOLDS,
    attributes,
  };
}

/** Re-resolve the same input with new attributes (what the UI does after a clarify tap). */
function withAttributes(input: ResolveInput, attributes: ResolvedAttributes): ResolveInput {
  return { ...input, attributes };
}

function summary(result: ResolveResult): string {
  switch (result.type) {
    case "answer":
      return `answer:${result.bin}:${result.rule_id}`;
    case "clarify":
      return `clarify:${result.attribute}:${result.item_id}`;
    case "abstain":
      return `abstain:${result.reason}`;
  }
}

function expectClarify(result: ResolveResult): Extract<ResolveResult, { type: "clarify" }> {
  if (result.type !== "clarify") throw new Error(`expected clarify, got ${summary(result)}`);
  return result;
}

function expectAnswer(result: ResolveResult): Extract<ResolveResult, { type: "answer" }> {
  if (result.type !== "answer") throw new Error(`expected answer, got ${summary(result)}`);
  return result;
}

function expectAbstain(result: ResolveResult): Extract<ResolveResult, { type: "abstain" }> {
  if (result.type !== "abstain") throw new Error(`expected abstain, got ${summary(result)}`);
  return result;
}

interface Row {
  name: string;
  input: ResolveInput;
  expected: string;
}

const VISION_ROWS: Row[] = [
  // answers
  { name: "unconditional entry", input: visionInput(vision([["cardboard_box", 0.95]])), expected: "answer:recycling:cardboard_box" },
  { name: "drop-off only film", input: visionInput(vision([["plastic_film", 0.9]])), expected: "answer:drop_off:plastic_film" },
  {
    name: "conditional entry with the attribute known from vision",
    input: visionInput(vision([["pizza_box", 0.86]]), { food_soiled: true }),
    expected: "answer:food_and_garden:pizza_box#0",
  },
  {
    name: "compostable marking seen",
    input: visionInput(vision([["compostable_plastic_cup", 0.9]]), { compostable_marking: true }),
    expected: "answer:food_and_garden:compostable_plastic_cup#0",
  },
  // clarify
  {
    name: "demo pizza box: food_soiled unknown",
    input: visionInput(vision([["pizza_box", 0.86]]), { food_soiled: null }),
    expected: "clarify:food_soiled:pizza_box",
  },
  {
    name: "device: battery unknown",
    input: visionInput(vision([["small_electrical_device", 0.9]])),
    expected: "clarify:contains_battery:small_electrical_device",
  },
  // 1 multiple_items
  { name: "two items", input: visionInput(vision([["cardboard_box", 0.95]], { item_count: 2 })), expected: "abstain:multiple_items" },
  {
    name: "multiple_items is checked before poor_image",
    input: visionInput(vision([["cardboard_box", 0.95]], { item_count: 3, image_quality: "blurry" })),
    expected: "abstain:multiple_items",
  },
  // 2 no_candidate
  { name: "item_count 0", input: visionInput(vision([["none", 0.9]], { item_count: 0 })), expected: "abstain:no_candidate" },
  {
    name: "top candidate is none",
    input: visionInput(vision([["none", 0.9], ["cardboard_box", 0.2]])),
    expected: "abstain:no_candidate",
  },
  { name: "no candidates at all", input: visionInput(vision([])), expected: "abstain:no_candidate" },
  {
    name: "only off-table ids (dropped)",
    input: visionInput(vision([["stress_item_001", 0.99]])),
    expected: "abstain:no_candidate",
  },
  {
    name: "off-table id is ignored, the valid candidate remains",
    input: visionInput(vision([["stress_item_001", 0.99], ["cardboard_box", 0.9]])),
    expected: "answer:recycling:cardboard_box",
  },
  {
    name: "no_candidate is checked before poor_image",
    input: visionInput(vision([["none", 0.9]], { item_count: 0, image_quality: "dark" })),
    expected: "abstain:no_candidate",
  },
  // 3 poor_image
  { name: "blurry", input: visionInput(vision([["cardboard_box", 0.95]], { image_quality: "blurry" })), expected: "abstain:poor_image" },
  { name: "dark", input: visionInput(vision([["cardboard_box", 0.95]], { image_quality: "dark" })), expected: "abstain:poor_image" },
  {
    name: "occluded",
    input: visionInput(vision([["cardboard_box", 0.95]], { image_quality: "occluded" })),
    expected: "abstain:poor_image",
  },
  {
    name: "poor_image is checked before low_confidence",
    input: visionInput(vision([["cardboard_box", 0.3]], { image_quality: "blurry" })),
    expected: "abstain:poor_image",
  },
  // 4 low_confidence
  { name: "below t_low", input: visionInput(vision([["cardboard_box", 0.5]])), expected: "abstain:low_confidence" },
  {
    name: "low_confidence is checked before ambiguous_bins",
    input: visionInput(vision([["clear_glass_bottle", 0.6], ["clear_plastic_bottle", 0.55]])),
    expected: "abstain:low_confidence",
  },
  // 5 ambiguous_bins
  {
    name: "glass vs plastic bottle near-tie: different bins",
    input: visionInput(vision([["clear_glass_bottle", 0.85], ["clear_plastic_bottle", 0.8]])),
    expected: "abstain:ambiguous_bins",
  },
  {
    name: "near-tie where one outcome set is still open (pizza box vs cardboard box, food_soiled unknown)",
    input: visionInput(vision([["pizza_box", 0.86], ["cardboard_box", 0.8]])),
    expected: "abstain:ambiguous_bins",
  },
  {
    name: "near-tie with the same single answer bin is not ambiguous",
    input: visionInput(vision([["aluminium_can", 0.85], ["steel_food_tin", 0.82]])),
    expected: "answer:recycling:aluminium_can",
  },
  {
    name: "near-tie resolved by a known attribute (both sets are the same single bin)",
    input: visionInput(vision([["pizza_box", 0.86], ["cardboard_box", 0.8]]), { food_soiled: false }),
    expected: "answer:recycling:pizza_box#1",
  },
  {
    name: "gap larger than margin is not ambiguous",
    input: visionInput(vision([["clear_glass_bottle", 0.95], ["clear_plastic_bottle", 0.5]])),
    expected: "answer:drop_off:clear_glass_bottle",
  },
  {
    name: "second candidate none does not make it ambiguous",
    input: visionInput(vision([["cardboard_box", 0.85], ["none", 0.8]])),
    expected: "answer:recycling:cardboard_box",
  },
  {
    name: "candidates are ranked by confidence, not by array order",
    input: visionInput(vision([["clear_plastic_bottle", 0.5], ["clear_glass_bottle", 0.95]])),
    expected: "answer:drop_off:clear_glass_bottle",
  },
  // 6 ask_council_rule (entry flag)
  { name: "ask_council entry", input: visionInput(vision([["paint_tin", 0.95]])), expected: "abstain:ask_council_rule" },
  // 8b ask_council_rule (instruction-only condition)
  {
    name: "instruction-only condition",
    input: visionInput(vision([["gas_cylinder", 0.95]]), { liquid_inside: true }),
    expected: "abstain:ask_council_rule",
  },
  {
    name: "the same entry answers through its bin condition",
    input: visionInput(vision([["gas_cylinder", 0.95]]), { liquid_inside: false }),
    expected: "answer:drop_off:gas_cylinder#1",
  },
  // 7: no question when known attributes already fix the outcome
  {
    name: "broken jar: priority-2 condition fixes the outcome, has_lid never asked",
    input: visionInput(vision([["glass_jar", 0.9]]), { broken: true, has_lid: null }),
    expected: "answer:garbage:glass_jar#0",
  },
  {
    name: "jar with every attribute unknown asks has_lid first (fixed scan order)",
    input: visionInput(vision([["glass_jar", 0.9]])),
    expected: "clarify:has_lid:glass_jar",
  },
  {
    name: "unconditional entry ignores unknown attributes",
    input: visionInput(vision([["black_plastic_tray", 0.9]]), { food_soiled: null, broken: null }),
    expected: "answer:garbage:black_plastic_tray",
  },
];

const SELECTED_ROWS: Row[] = [
  { name: "typed cardboard box", input: selectedInput("cardboard_box"), expected: "answer:recycling:cardboard_box" },
  { name: "typed aerosol", input: selectedInput("aerosol_can"), expected: "clarify:liquid_inside:aerosol_can" },
  { name: "typed paint tin", input: selectedInput("paint_tin"), expected: "abstain:ask_council_rule" },
  { name: "unknown id", input: selectedInput("stress_item_042"), expected: "abstain:no_candidate" },
  { name: "the none id", input: selectedInput("none"), expected: "abstain:no_candidate" },
  { name: "typed glass jar asks has_lid first", input: selectedInput("glass_jar"), expected: "clarify:has_lid:glass_jar" },
];

describe("resolve: vision mode table", () => {
  it.each(VISION_ROWS)("$name -> $expected", ({ input, expected }) => {
    expect(summary(resolve(input))).toBe(expected);
  });
});

describe("resolve: selected mode table", () => {
  it.each(SELECTED_ROWS)("$name -> $expected", ({ input, expected }) => {
    expect(summary(resolve(input))).toBe(expected);
  });
});

describe("resolve: answer, clarify and abstain payloads", () => {
  it("an answer carries bin label, prep, rule id, citation, verified_on, rules version and council link", () => {
    const result = expectAnswer(resolve(visionInput(vision([["pizza_box", 0.86]]), { food_soiled: true })));
    const entry = entryById(rules, "pizza_box");
    expect(result.item_id).toBe("pizza_box");
    expect(result.item_name).toBe("Pizza box");
    expect(result.bin_label).toBe("Food and garden (green lid)");
    expect(result.prep_steps).toEqual(entry.conditions[0]?.prep_steps);
    expect(result.rule_id).toBe("pizza_box#0");
    expect(result.citation).toEqual({
      rule_id: "pizza_box#0",
      url: "https://fixture-city.example.invalid/rules#pizza_box",
      fragment: "pizza_box",
      section: entry.source.section,
      verified_on: "2026-10-24",
      retrieved_on: "2026-10-24",
      source_kind: "fixture",
      rules_version: TEST_RULES_VERSION,
    });
    expect(result.rules_version).toBe(TEST_RULES_VERSION);
    expect(result.council_url).toBe(rules.locality.council_url);
    expect(result.mode).toBe("vision");
  });

  it("an unconditional answer uses the entry prep steps and the bare entry id as rule id", () => {
    const result = expectAnswer(resolve(selectedInput("cardboard_box")));
    expect(result.rule_id).toBe("cardboard_box");
    expect(result.citation.rule_id).toBe("cardboard_box");
    expect(result.prep_steps).toEqual(entryById(rules, "cardboard_box").prep_steps);
    expect(result.instruction).toBeNull();
  });

  it("a clarify carries the rule's own question and Yes / No / Not sure", () => {
    const result = expectClarify(resolve(visionInput(vision([["pizza_box", 0.86]]))));
    expect(result.question).toBe("Is the box greasy or has food stuck to it?");
    expect(result.options).toEqual(["yes", "no", "not_sure"]);
  });

  it("every abstain carries the council link and the rules version", () => {
    const result = expectAbstain(resolve(visionInput(vision([["cardboard_box", 0.95]], { item_count: 2 }))));
    expect(result.council_url).toBe(rules.locality.council_url);
    expect(result.rules_version).toBe(TEST_RULES_VERSION);
    expect(result.item_id).toBeNull();
  });

  it("ambiguous_bins names both near-tied items", () => {
    const result = expectAbstain(resolve(visionInput(vision([["clear_glass_bottle", 0.85], ["clear_plastic_bottle", 0.8]]))));
    expect(result.reason).toBe("ambiguous_bins");
    expect(result.candidate_ids).toEqual(["clear_glass_bottle", "clear_plastic_bottle"]);
  });

  it("ask_council entry cites its rule; instruction-only condition shows its instruction text", () => {
    const paint = expectAbstain(resolve(selectedInput("paint_tin")));
    expect(paint.rule_id).toBe("paint_tin");
    expect(paint.citation?.url).toBe("https://fixture-city.example.invalid/rules#paint_tin");
    expect(paint.instruction).toBeNull();

    const gas = expectAbstain(resolve(visionInput(vision([["gas_cylinder", 0.95]]), { liquid_inside: true })));
    expect(gas.reason).toBe("ask_council_rule");
    expect(gas.rule_id).toBe("gas_cylinder#0");
    expect(gas.instruction).toBe(entryById(rules, "gas_cylinder").conditions[0]?.instruction);
    expect(gas.citation?.rule_id).toBe("gas_cylinder#0");
  });
});

describe("resolve: clarify flows", () => {
  it("demo pizza box: clarify -> Yes -> re-resolve -> answer", () => {
    const input = visionInput(vision([["pizza_box", 0.86]]));
    const clarify = expectClarify(resolve(input));
    const next = applyClarifyAnswer(input.attributes, clarify.attribute, "yes");
    expect(summary(resolve(withAttributes(input, next)))).toBe("answer:food_and_garden:pizza_box#0");
  });

  it("pizza box: clarify -> No -> recycling", () => {
    const input = visionInput(vision([["pizza_box", 0.86]]));
    const clarify = expectClarify(resolve(input));
    const next = applyClarifyAnswer(input.attributes, clarify.attribute, "no");
    expect(summary(resolve(withAttributes(input, next)))).toBe("answer:recycling:pizza_box#1");
  });

  it("demo aerosol (typed): clarify -> Not sure -> unknown_condition, and the attribute is never asked again", () => {
    const input = selectedInput("aerosol_can");
    const clarify = expectClarify(resolve(input));
    expect(clarify.attribute).toBe("liquid_inside");
    const next = applyClarifyAnswer(input.attributes, "liquid_inside", "not_sure");
    const result = resolve(withAttributes(input, next));
    expect(summary(result)).toBe("abstain:unknown_condition");
    expect(expectAbstain(result).item_id).toBe("aerosol_can");
  });

  it("glass jar: asks has_lid, then broken, then answers through the matching condition", () => {
    const input = selectedInput("glass_jar");
    const first = expectClarify(resolve(input));
    expect(first.attribute).toBe("has_lid");
    const afterLid = applyClarifyAnswer(input.attributes, "has_lid", "yes");
    const second = expectClarify(resolve(withAttributes(input, afterLid)));
    expect(second.attribute).toBe("broken");
    const afterBroken = applyClarifyAnswer(afterLid, "broken", "no");
    const result = expectAnswer(resolve(withAttributes(input, afterBroken)));
    expect(result.rule_id).toBe("glass_jar#1");
    expect(result.prep_steps[0]).toMatch(/lid/);
  });

  it("glass jar: Not sure on has_lid moves on to broken; broken=yes still answers (priority 2)", () => {
    const input = selectedInput("glass_jar");
    const unsureLid = applyClarifyAnswer(input.attributes, "has_lid", "not_sure");
    expect(expectClarify(resolve(withAttributes(input, unsureLid))).attribute).toBe("broken");
    const broken = applyClarifyAnswer(unsureLid, "broken", "yes");
    expect(summary(resolve(withAttributes(input, broken)))).toBe("answer:garbage:glass_jar#0");
  });

  it("glass jar: Not sure on has_lid and broken=no leaves the outcome open -> unknown_condition", () => {
    const input = selectedInput("glass_jar");
    const attrs = applyClarifyAnswer(applyClarifyAnswer(input.attributes, "has_lid", "not_sure"), "broken", "no");
    expect(summary(resolve(withAttributes(input, attrs)))).toBe("abstain:unknown_condition");
  });

  it("unknown_condition when no condition matches the known attributes", () => {
    const partial = rawFixture();
    const pizza = entryById(partial, "pizza_box");
    pizza.conditions = pizza.conditions.filter((c) => c.when.food_soiled === true);
    const input = selectedInput("pizza_box", emptyAttributes(), partial);
    const attrs = applyClarifyAnswer(input.attributes, "food_soiled", "no");
    expect(summary(resolve(withAttributes(input, attrs)))).toBe("abstain:unknown_condition");
  });

  it("vision values are used but a user answer is what fills a null vision attribute", () => {
    const input = visionInput(vision([["small_electrical_device", 0.9]]), { contains_battery: null });
    const attrs = applyClarifyAnswer(input.attributes, "contains_battery", "yes");
    expect(summary(resolve(withAttributes(input, attrs)))).toBe("answer:hazardous_drop_off:small_electrical_device#0");
  });
});

describe("resolve: Change item (selected mode)", () => {
  it("a blurry photo becomes answerable after Change item", () => {
    expect(summary(resolve(visionInput(vision([["cardboard_box", 0.95]], { image_quality: "blurry" }))))).toBe(
      "abstain:poor_image",
    );
    const changed = selectedInput("cardboard_box", changeItemAttributes());
    expect(summary(resolve(changed))).toBe("answer:recycling:cardboard_box");
    expect(resolve(changed).mode).toBe("selected");
  });

  it("a two-item photo becomes answerable after Change item", () => {
    expect(summary(resolve(visionInput(vision([["cardboard_box", 0.95]], { item_count: 2 }))))).toBe(
      "abstain:multiple_items",
    );
    expect(summary(resolve(selectedInput("cardboard_box", changeItemAttributes())))).toBe(
      "answer:recycling:cardboard_box",
    );
  });

  it("a low-confidence or ambiguous photo becomes answerable after Change item", () => {
    expect(summary(resolve(visionInput(vision([["clear_glass_bottle", 0.85], ["clear_plastic_bottle", 0.8]]))))).toBe(
      "abstain:ambiguous_bins",
    );
    expect(summary(resolve(selectedInput("clear_plastic_bottle", changeItemAttributes())))).toBe(
      "answer:recycling:clear_plastic_bottle",
    );
  });

  it("clears vision attributes: the new item asks its own question again", () => {
    const photo = visionInput(vision([["pizza_box", 0.86]]), { food_soiled: true });
    expect(summary(resolve(photo))).toBe("answer:food_and_garden:pizza_box#0");
    expect(summary(resolve(selectedInput("paper_plate", changeItemAttributes())))).toBe("clarify:food_soiled:paper_plate");
  });

  it("clears user answers: a Yes given for the old item does not carry over", () => {
    const photo = visionInput(vision([["pizza_box", 0.86]]));
    const answered = applyClarifyAnswer(photo.attributes, "food_soiled", "yes");
    expect(summary(resolve(withAttributes(photo, answered)))).toBe("answer:food_and_garden:pizza_box#0");
    // "Change item" -> search "cardboard box" -> select; user answers cleared
    expect(summary(resolve(selectedInput("cardboard_box", changeItemAttributes())))).toBe("answer:recycling:cardboard_box");
    expect(summary(resolve(selectedInput("pizza_box", changeItemAttributes())))).toBe("clarify:food_soiled:pizza_box");
  });
});

describe("resolve: invariants", () => {
  it("covers all seven reason codes (self-contained: computed here, not from earlier tests' state)", () => {
    const seen = new Set<ReasonCode>();
    const note = (result: ResolveResult): void => {
      if (result.type === "abstain") seen.add(result.reason);
    };
    for (const row of [...VISION_ROWS, ...SELECTED_ROWS]) note(resolve(row.input));
    // unknown_condition is reachable only through a clarify flow: typed aerosol -> "Not sure".
    const aerosol = selectedInput("aerosol_can");
    note(resolve(withAttributes(aerosol, applyClarifyAnswer(aerosol.attributes, "liquid_inside", "not_sure"))));
    expect([...seen].sort()).toEqual([...REASON_CODES].sort());
  });

  it("exports resolve and nothing else at runtime (selectBin stays module-private)", () => {
    expect(Object.keys(resolveModule)).toEqual(["resolve"]);
    expect("selectBin" in resolveModule).toBe(false);
  });

  it("never answers with a bin the rules file does not declare", () => {
    const broken = rawFixture();
    broken.bins = broken.bins.filter((bin) => bin.id !== "recycling");
    expect(() => resolve(selectedInput("cardboard_box", emptyAttributes(), broken))).toThrow(/not declared/);
  });

  it("is deterministic", () => {
    const input = visionInput(vision([["glass_jar", 0.9]]), { broken: false, has_lid: false });
    expect(resolve(input)).toEqual(resolve(input));
    expect(summary(resolve(input))).toBe("answer:recycling:glass_jar#2");
  });
});

import { describe, expect, it } from "vitest";
import { fairness, metrics } from "../src/evalkit/metrics.ts";
import { systemObservation } from "../scripts/baselines/system.ts";
import { goldRow, nullAttributes, observation } from "./helpers/evalRows.ts";
import { rawFixture, TEST_RULES_VERSION, TEST_THRESHOLDS } from "./helpers/fixtureRules.ts";
describe("metric denominators", () => {
  it("counts unknown attribute, abstention and unresolved clarify denominators explicitly", () => {
    const make = (id: string, truth: boolean | null, pred: boolean | null) => observation(id, {
      gold: goldRow({ expected_outcome: "answer:garbage", true_attributes: { ...nullAttributes(), food_soiled: truth } }),
      outcome: "answer:garbage", attributes: { ...nullAttributes(), food_soiled: pred } });
    const a = make("a", true, true), b = make("b", true, null), c = make("c", false, true), d = make("d", null, null);
    b.outcome = "abstain"; c.outcome = "answer:recycling"; d.outcome = "abstain"; d.gold.expected_outcome = "abstain";
    const m = metrics([a, b, c, d, observation("e", { outcome: "clarify", gold: goldRow({ expected_outcome: "clarify" }) })]);
    expect(m.answered).toBe(2); expect(m.wrong).toEqual({ numerator: 1, denominator: 2, value: 0.5 });
    expect(m.abstention_precision.value).toBe(0.5); expect(m.abstention_recall.value).toBe(1); expect(m.over_abstention.value).toBe(1 / 3);
    expect(m.clarify_rate.value).toBe(1 / 5); expect(m.clarify_on_gold_clarify.value).toBe(1);
    expect(m.attributes.food_soiled).toMatchObject({ precision: { numerator: 1, denominator: 2, value: 0.5 }, recall: { numerator: 1, denominator: 2, value: 0.5 }, null_rate: { numerator: 2, denominator: 4, value: 0.5 }, known_gold: 3 });
    expect(m.latency_ms).toEqual({ p50: null, p95: null, measured: 0 });
  });
  it("reports N/A when there is no denominator or a method does not identify item ids", () => {
    expect(metrics([]).correct.value).toBeNull(); expect(metrics([]).wrong_wilson).toBeNull();
    expect(metrics([observation("generic", { predicted_item: null })]).item_accuracy.value).toBeNull();
    const m = metrics([observation("a", { latency_ms: 10 }), observation("b", { latency_ms: 40 }), observation("c", { latency_ms: 20 })]);
    expect(m.latency_ms).toEqual({ p50: 20, p95: 40, measured: 3 });
  });
  it("keeps schema-rejected System responses in attribute recall and missing-rate populations", () => {
    // Regression: nine rejected outputs previously vanished, yielding recall 1/1 and null rate 0/1.
    const rules = rawFixture();
    const gold = goldRow({ true_attributes: { ...nullAttributes(), food_soiled: true } });
    const raw = { item_count: 1, candidates: [{ item_id: "cardboard_box", confidence: 0.95 }], free_label: "box",
      attributes: { ...nullAttributes(), food_soiled: true, image_quality: "good" } };
    const valid = systemObservation(gold, raw, rules, TEST_RULES_VERSION, TEST_THRESHOLDS, "mock");
    const rejected = Array.from({ length: 9 }, (_, i) => systemObservation({ ...gold, photo_id: `rejected-${i}` },
      { ...raw, bin: "recycling" }, rules, TEST_RULES_VERSION, TEST_THRESHOLDS, "mock"));
    expect(rejected.every((r) => r.predicted_item === "invalid_response" && r.attributes === null && r.attribute_capable === true)).toBe(true);
    const attr = metrics([valid, ...rejected]).attributes.food_soiled;
    expect(attr).toEqual({ precision: { numerator: 1, denominator: 1, value: 1 },
      recall: { numerator: 1, denominator: 10, value: 0.1 }, null_rate: { numerator: 9, denominator: 10, value: 0.9 }, known_gold: 10 });
    expect(metrics(rejected).attributes.food_soiled).toEqual({ precision: { numerator: 0, denominator: 0, value: null },
      recall: { numerator: 0, denominator: 9, value: 0 }, null_rate: { numerator: 9, denominator: 9, value: 1 }, known_gold: 9 });
  });
  it("counts a missing attribute prediction only for an attribute-capable method and preserves zero-gold N/A", () => {
    const missing = observation("missing", { attribute_capable: true });
    const attr = metrics([missing]).attributes.food_soiled;
    expect(attr).toEqual({ precision: { numerator: 0, denominator: 0, value: null },
      recall: { numerator: 0, denominator: 0, value: null }, null_rate: { numerator: 1, denominator: 1, value: 1 }, known_gold: 0 });
    expect(metrics([observation("no-attribute-method")]).attributes.food_soiled).toEqual({
      precision: { numerator: 0, denominator: 0, value: null }, recall: { numerator: 0, denominator: 0, value: null },
      null_rate: { numerator: 0, denominator: 0, value: null }, known_gold: 0 });
  });
  it("aligns same-subset/common-answer comparisons by id and exposes missing rows", () => {
    const system = [observation("a"), observation("b", { outcome: "abstain" }), observation("c")];
    const other = [observation("c", { outcome: "abstain" }), observation("b"), observation("a", { outcome: "answer:garbage" })];
    const f = fairness(system, other);
    expect(f.system_answered_subset.metrics.n).toBe(2); expect(f.common_answered.system.n).toBe(1);
    expect(f.equal_coverage.status).toBe("matched");
    expect(f.claim_supported).toBe(false); expect(fairness(system, other.slice(1)).system_answered_subset.complete).toBe(false);
  });
  it("marks different attainable confidence-tie floors unavailable for equal-coverage comparison", () => {
    const system = [observation("a", { confidence: 0.9 }), observation("b", { confidence: 0.9 }),
      observation("c", { confidence: 0.8 }), observation("d", { outcome: "abstain" })];
    const other = [observation("a", { confidence: 0.9 }), observation("b", { confidence: 0.8 }),
      observation("c", { confidence: 0.8 }), observation("d", { confidence: 0.8 })];
    const equal = fairness(system, other).equal_coverage;
    expect(equal).toMatchObject({ target: 0.75, status: "unavailable", reason: "unequal_attained_coverage",
      actual_system: { numerator: 3, denominator: 4, value: 0.75 }, actual_comparator: { numerator: 1, denominator: 4, value: 0.25 } });
    expect(fairness([], []).equal_coverage).toMatchObject({ status: "unavailable", reason: "no_nonzero_coverage" });
  });
});

import { ATTRIBUTE_ORDER } from "../core/rules.ts";
import { ratio, isAnswered } from "./types.ts";
import type { Observation } from "./types.ts";
import { wilson } from "./wilson.ts";
import { costScore } from "./costScore.ts";
import { namedErrors } from "./namedErrors.ts";
import { atCoverage, riskCoverage } from "./riskCoverage.ts";

function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)] ?? null;
}
export function metrics(rows: readonly Observation[]) {
  const n = rows.length;
  const answered = rows.filter((r) => isAnswered(r.outcome));
  const correct = answered.filter((r) => r.outcome === r.gold.expected_outcome).length;
  const goldAbstain = rows.filter((r) => r.gold.expected_outcome === "abstain");
  const abstained = rows.filter((r) => r.outcome === "abstain");
  const trueAbstain = abstained.filter((r) => r.gold.expected_outcome === "abstain").length;
  const goldAnswer = rows.filter((r) => isAnswered(r.gold.expected_outcome));
  const goldClarify = rows.filter((r) => r.gold.expected_outcome === "clarify");
  // Capability is distinct from an available prediction: a rejected System response is still evaluated.
  const attributeRows = rows.filter((r) => r.attribute_capable === true || r.attributes !== null);
  const attributes = Object.fromEntries(ATTRIBUTE_ORDER.map((attr) => {
    const knownGold = attributeRows.filter((r) => r.gold.true_attributes[attr] !== null);
    const tp = knownGold.filter((r) => r.attributes?.[attr] === true && r.gold.true_attributes[attr] === true).length;
    const predictedPositive = knownGold.filter((r) => r.attributes?.[attr] === true).length;
    const goldPositive = knownGold.filter((r) => r.gold.true_attributes[attr] === true).length;
    return [attr, { precision: ratio(tp, predictedPositive), recall: ratio(tp, goldPositive),
      null_rate: ratio(attributeRows.filter((r) => (r.attributes?.[attr] ?? null) === null).length, attributeRows.length),
      known_gold: knownGold.length }];
  }));
  const latency = rows.flatMap((r) => r.latency_ms === null ? [] : [r.latency_ms]);
  const itemRows = rows.filter((r) => r.predicted_item !== null);
  const itemCorrect = itemRows.filter((r) => r.predicted_item === (r.gold.item_id === "out_of_table" ? "none" : r.gold.item_id)).length;
  return { n, item_accuracy: ratio(itemCorrect, itemRows.length), attributes,
    answered: answered.length, correct: ratio(correct, answered.length), wrong: ratio(answered.length - correct, answered.length),
    correct_wilson: wilson(correct, answered.length), wrong_wilson: wilson(answered.length - correct, answered.length),
    coverage: ratio(answered.length, n), abstention_precision: ratio(trueAbstain, abstained.length),
    abstention_recall: ratio(trueAbstain, goldAbstain.length),
    over_abstention: ratio(goldAnswer.filter((r) => r.outcome === "abstain").length, goldAnswer.length),
    clarify_rate: ratio(rows.filter((r) => r.outcome === "clarify").length, n),
    clarify_on_gold_clarify: ratio(goldClarify.filter((r) => r.outcome === "clarify").length, goldClarify.length),
    cost: costScore(rows), errors: namedErrors(rows), risk_coverage: riskCoverage(rows),
    latency_ms: { p50: percentile(latency, 0.5), p95: percentile(latency, 0.95), measured: latency.length } };
}

/** All comparisons explicitly align by id; missing comparator predictions are unavailable. */
export function fairness(system: readonly Observation[], comparator: readonly Observation[]) {
  const byId = new Map(comparator.map((r) => [r.id, r]));
  const systemAnswered = system.filter((r) => isAnswered(r.outcome));
  const subset = systemAnswered.flatMap((r) => byId.has(r.id) ? [byId.get(r.id)!] : []);
  const commonSystem = systemAnswered.filter((r) => isAnswered(byId.get(r.id)?.outcome ?? "abstain"));
  const commonOther = commonSystem.map((r) => byId.get(r.id)!);
  const target = Math.min(metrics(system).coverage.value ?? 0, metrics(comparator).coverage.value ?? 0);
  const systemEqual = atCoverage(system, target), otherEqual = atCoverage(comparator, target);
  const nonzero = systemEqual.length > 0 && otherEqual.length > 0;
  const matched = nonzero && systemEqual.length * comparator.length === otherEqual.length * system.length;
  const complete = subset.length === systemAnswered.length && systemAnswered.length > 0;
  const s = metrics(systemAnswered), c = metrics(subset);
  return { comparator_all: metrics(comparator), system_answered_subset: { complete, expected: systemAnswered.length, metrics: c },
    common_answered: { system: metrics(commonSystem), comparator: metrics(commonOther) },
    equal_coverage: { status: matched ? "matched" : "unavailable", reason: matched ? null : nonzero ? "unequal_attained_coverage" : "no_nonzero_coverage",
      target, system: metrics(systemEqual), comparator: metrics(otherEqual),
      actual_system: ratio(systemEqual.length, system.length), actual_comparator: ratio(otherEqual.length, comparator.length) },
    claim_supported: complete && subset.every((r) => isAnswered(r.outcome)) &&
      (s.wrong.value ?? 1) < (c.wrong.value ?? 0) && s.cost.contaminating <= c.cost.contaminating };
}

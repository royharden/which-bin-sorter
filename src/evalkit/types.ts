import type { Attr } from "../core/rules.ts";

export type Outcome = `answer:${string}` | "clarify" | "abstain";
export type AttributeValues = Record<Attr, boolean | null>;
export interface GoldRow {
  photo_id: string;
  file: string | null;
  sha256: string | null;
  item_id: string | "out_of_table";
  item_group: string;
  true_attributes: AttributeValues;
  expected_outcome: Outcome;
  rule_id: string | null;
  licence: string;
  split: "dev" | "heldout";
  query?: string;
}
export interface Observation {
  id: string;
  gold: GoldRow;
  outcome: Outcome;
  predicted_item: string | null;
  attributes: AttributeValues | null;
  /** True when this method predicts attributes, including rejected/missing predictions. Non-null attributes also imply capability. */
  attribute_capable?: boolean;
  confidence: number | null;
  provenance: string;
  cost_usd: number | null;
  latency_ms: number | null;
  note?: string;
}
export interface Ratio { numerator: number; denominator: number; value: number | null }
export function ratio(numerator: number, denominator: number): Ratio {
  return { numerator, denominator, value: denominator === 0 ? null : numerator / denominator };
}
export function isAnswered(outcome: Outcome): outcome is `answer:${string}` {
  return outcome.startsWith("answer:");
}

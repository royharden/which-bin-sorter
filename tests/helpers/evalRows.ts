import type { GoldRow, Observation, AttributeValues } from "../../src/evalkit/types.ts";
export function nullAttributes(): AttributeValues { return { food_soiled: null, liquid_inside: null, has_lid: null, contains_battery: null, broken: null, compostable_marking: null }; }
export function goldRow(overrides: Partial<GoldRow> = {}): GoldRow {
  return { photo_id: "sample", file: null, sha256: null, item_id: "cardboard_box", item_group: "cardboard_box", true_attributes: nullAttributes(), expected_outcome: "answer:recycling", rule_id: "cardboard_box", licence: "fixture", split: "dev", ...overrides };
}
export function observation(id: string, overrides: Partial<Observation> = {}): Observation {
  return { id, gold: goldRow({ photo_id: id }), outcome: "answer:recycling", predicted_item: "cardboard_box", attributes: null, confidence: 0.9, provenance: "mock", cost_usd: null, latency_ms: null, ...overrides };
}

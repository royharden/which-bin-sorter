import { resolve } from "../../src/core/resolve.ts";
import { emptyAttributes, fromVision } from "../../src/core/attributes.ts";
import { searchItems } from "../../src/core/search.ts";
import type { RulesFile } from "../../src/core/rules.ts";
import type { Thresholds } from "../../src/core/thresholds.ts";
import type { GoldRow, Observation } from "../../src/evalkit/types.ts";
import { outcomeOf } from "./system.ts";

export function typedOracle(gold: GoldRow, rules: RulesFile, version: string, thresholds: Thresholds): Observation {
  const result = resolve({ mode: "selected", item_id: gold.item_id, rules, rulesVersion: version, thresholds, attributes: fromVision(gold.true_attributes) });
  return { id: gold.photo_id, gold, outcome: outcomeOf(result), predicted_item: gold.item_id === "out_of_table" ? "none" : gold.item_id,
    attributes: gold.true_attributes, confidence: 1, provenance: "deterministic:gold-oracle", cost_usd: 0, latency_ms: null };
}
/** T1 never consumes gold item/attributes. Ambiguous token results require selection and remain clarify. */
export function textResolver(gold: GoldRow, rules: RulesFile, version: string, thresholds: Thresholds): Observation {
  if (gold.query === undefined) throw new Error("T1 requires text query");
  const match = searchItems(rules, gold.query);
  const id = match.kind === "exact" ? match.entry_id : match.kind === "candidates" && match.entry_ids.length === 1 ? match.entry_ids[0] : undefined;
  const outcome = id === undefined ? match.kind === "none" ? "abstain" : "clarify" : outcomeOf(resolve({ mode: "selected", item_id: id, rules, rulesVersion: version, thresholds, attributes: emptyAttributes() }));
  return { id: gold.photo_id, gold, outcome, predicted_item: id ?? (match.kind === "none" ? "none" : "ambiguous_selection"), attributes: null,
    confidence: id === undefined ? null : match.kind === "exact" ? 1 : 0.5, provenance: "deterministic:text-search", cost_usd: 0, latency_ms: null };
}

import { resolve } from "../../src/core/resolve.ts";
import type { ResolveResult } from "../../src/core/resolve.ts";
import type { RulesFile } from "../../src/core/rules.ts";
import type { Thresholds } from "../../src/core/thresholds.ts";
import { fromVision } from "../../src/core/attributes.ts";
import { validateVisionOutput } from "../../supabase/functions/identify/visionSchema.ts";
import type { GoldRow, Observation, Outcome } from "../../src/evalkit/types.ts";

export function outcomeOf(result: ResolveResult): Outcome { return result.type === "answer" ? `answer:${result.bin}` : result.type; }
export function systemObservation(gold: GoldRow, raw: unknown, rules: RulesFile, rulesVersion: string, thresholds: Thresholds, provenance: string, ablation = false): Observation {
  const validated = validateVisionOutput(raw, rules.entries.map((e) => e.id));
  if (!validated.ok) return { id: gold.photo_id, gold, outcome: "abstain", predicted_item: "invalid_response", attributes: null, attribute_capable: true, confidence: null, provenance, cost_usd: null, latency_ms: null, note: `vision rejected: ${validated.error.code}` };
  const vision = validated.value;
  const top = [...vision.candidates].sort((a, b) => b.confidence - a.confidence)[0];
  const common = { rules, rulesVersion, attributes: fromVision(vision.attributes), thresholds };
  // Gates off = selected mode only after genuine no-match/multiple checks. Unknown conditions are preserved.
  const result = ablation && vision.item_count === 1 && top !== undefined && top.item_id !== "none"
    ? resolve({ ...common, mode: "selected", item_id: top.item_id })
    : resolve({ ...common, mode: "vision", vision: { item_count: vision.item_count, candidates: vision.candidates, image_quality: vision.attributes.image_quality } });
  return { id: gold.photo_id, gold, outcome: outcomeOf(result), predicted_item: top?.item_id ?? "none", attributes: vision.attributes, attribute_capable: true,
    confidence: top?.confidence ?? null, provenance, cost_usd: null, latency_ms: null };
}

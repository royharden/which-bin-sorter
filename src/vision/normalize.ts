// Browser-side vision normalizer (PLAN.md 4.3 [C]): re-runs the SAME validator the edge function runs on whatever
// arrives (defence in depth; identical path in demo mode), blanks free_label, and maps the result to the resolver's
// vision-mode inputs. Imports only allowlisted function files (visionSchema.ts, itemIds.generated.ts).
// A rejection is reported, never repaired; vision/client.ts (M3) maps it to abstain `no_candidate` + a debug note.
import { validateAndNormalize } from "../../supabase/functions/identify/visionSchema.ts";
import type { VisionErrorCode, VisionOutput } from "../../supabase/functions/identify/visionSchema.ts";
import { ITEM_IDS } from "../../supabase/functions/identify/itemIds.generated.ts";
import type { VisionEvidence } from "../core/resolve.ts";
import type { VisionAttributeValues } from "../core/attributes.ts";

export interface NormalizedVision {
  /** Validated output with free_label "" (the UI shows the table's display name, or "Unrecognized item"). */
  readonly vision: VisionOutput;
  /** What the resolver gates on in vision mode (steps 1-5). */
  readonly evidence: VisionEvidence;
  /** Input to `fromVision()` (null = the model could not tell). */
  readonly attributes: VisionAttributeValues;
  /** Candidate ids the validator dropped because they are not in the closed list. */
  readonly dropped_ids: readonly string[];
}

export type NormalizeResult =
  | { readonly ok: true; readonly value: NormalizedVision }
  | { readonly ok: false; readonly reason: VisionErrorCode; readonly path: string };

export function toEvidence(vision: VisionOutput): VisionEvidence {
  return {
    item_count: vision.item_count,
    candidates: vision.candidates.map((candidate) => ({ item_id: candidate.item_id, confidence: candidate.confidence })),
    image_quality: vision.attributes.image_quality,
  };
}

export function toAttributeValues(vision: VisionOutput): VisionAttributeValues {
  const { food_soiled, liquid_inside, has_lid, contains_battery, broken, compostable_marking } = vision.attributes;
  return { food_soiled, liquid_inside, has_lid, contains_battery, broken, compostable_marking };
}

/** Validate + normalize an untrusted vision output (live response body field or local mock output). */
export function normalizeVision(raw: unknown, closedList: readonly string[] = ITEM_IDS): NormalizeResult {
  const result = validateAndNormalize(raw, closedList);
  if (!result.ok) return { ok: false, reason: result.error.code, path: result.error.path };
  return {
    ok: true,
    value: {
      vision: result.value,
      evidence: toEvidence(result.value),
      attributes: toAttributeValues(result.value),
      dropped_ids: result.dropped_ids,
    },
  };
}

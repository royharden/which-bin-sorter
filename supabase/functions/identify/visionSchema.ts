// Bin-free vision output schema + hand-written validator (PLAN.md 4.3; no zod). Allowlisted for the browser bundle:
// the browser re-runs this same validator on what it receives (defence in depth, same path in demo mode).
// Pure TypeScript, no imports. The model reports WHAT the item is and its condition, never where it goes:
// a forbidden disposal key anywhere in the output is a hard reject (`rejected_bin_field`), unknown keys at any depth
// are rejected, confidences are never clamped, and candidate ids outside the closed list are dropped.

/** Vision schema version (echoed as `schema_version`). Re-exported by serverConfig.ts. */
export const SCHEMA_VERSION = 1;

/** Upload preprocessing contract: client re-encodes to JPEG, long side <= 1024 px. Re-exported by serverConfig.ts. */
export const PREPROCESSING_VERSION = "jpeg-1024-v1";

export const MAX_CANDIDATES = 3;
export const FREE_LABEL_MAX = 80;
export const ITEM_ID_MAX = 64;
/** The reserved "not in the table" candidate id. */
export const NONE_ITEM_ID = "none";
/** Maximum nesting depth of a vision output (the real shape needs 3). */
export const MAX_VISION_DEPTH = 6;

/** Same six boolean attributes, same order, as `ATTRIBUTE_ORDER` in src/core/rules.ts (parity-tested). */
export const VISION_ATTRIBUTE_KEYS = [
  "food_soiled",
  "liquid_inside",
  "has_lid",
  "contains_battery",
  "broken",
  "compostable_marking",
] as const;

export const IMAGE_QUALITIES = ["good", "blurry", "dark", "occluded"] as const;

export type VisionAttributeKey = (typeof VISION_ATTRIBUTE_KEYS)[number];
export type VisionImageQuality = (typeof IMAGE_QUALITIES)[number];

export type VisionAttributes = { readonly [K in VisionAttributeKey]: boolean | null } & {
  readonly image_quality: VisionImageQuality;
};

export interface VisionCandidateOut {
  readonly item_id: string;
  readonly confidence: number;
}

export interface VisionOutput {
  readonly item_count: number;
  readonly candidates: readonly VisionCandidateOut[];
  /** Raw model label. Blanked to "" by `blankFreeLabel` before any response or storage. */
  readonly free_label: string;
  readonly attributes: VisionAttributes;
}

export type VisionErrorCode =
  | "rejected_bin_field"
  | "not_object"
  | "unknown_key"
  | "missing_key"
  | "wrong_type"
  | "out_of_range"
  | "too_many_candidates"
  | "label_too_long"
  | "too_deep";

export interface VisionError {
  readonly code: VisionErrorCode;
  /** JSON-pointer-like location, e.g. `/candidates/0/confidence`. Never contains model text. */
  readonly path: string;
}

export type VisionValidation =
  | { readonly ok: true; readonly value: VisionOutput; readonly dropped_ids: readonly string[] }
  | { readonly ok: false; readonly error: VisionError };

const TOP_KEYS = ["item_count", "candidates", "free_label", "attributes"] as const;
const CANDIDATE_KEYS = ["item_id", "confidence"] as const;
const ATTRIBUTE_KEYS: readonly string[] = [...VISION_ATTRIBUTE_KEYS, "image_quality"];

/** Disposal-decision keys that a vision output must never carry, at any depth (compared case-insensitively). */
const FORBIDDEN_KEYS: ReadonlySet<string> = new Set(["bin", "bin_id"]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function fail(code: VisionErrorCode, path: string): VisionValidation {
  return { ok: false, error: { code, path } };
}

/** Walks the whole value once: forbidden keys at any depth, then the depth bound. Iterative (no recursion limit). */
function scanTree(raw: unknown): VisionError | null {
  const stack: Array<{ value: unknown; path: string; depth: number }> = [{ value: raw, path: "", depth: 0 }];
  let tooDeep: VisionError | null = null;
  while (stack.length > 0) {
    const frame = stack.pop();
    if (frame === undefined) break;
    const { value, path, depth } = frame;
    if (typeof value !== "object" || value === null) continue;
    if (depth > MAX_VISION_DEPTH) {
      if (tooDeep === null) tooDeep = { code: "too_deep", path };
      continue;
    }
    if (Array.isArray(value)) {
      value.forEach((item: unknown, index) => stack.push({ value: item, path: `${path}/${index}`, depth: depth + 1 }));
      continue;
    }
    for (const key of Object.keys(value)) {
      if (FORBIDDEN_KEYS.has(key.toLowerCase())) return { code: "rejected_bin_field", path: `${path}/${key}` };
      stack.push({ value: (value as Record<string, unknown>)[key], path: `${path}/${key}`, depth: depth + 1 });
    }
  }
  return tooDeep;
}

function checkKeys(record: Record<string, unknown>, allowed: readonly string[], path: string): VisionError | null {
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key)) return { code: "unknown_key", path: `${path}/${key}` };
  }
  for (const key of allowed) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) return { code: "missing_key", path: `${path}/${key}` };
  }
  return null;
}

/**
 * Validates an untrusted vision output against the closed item list. Never clamps or repairs a value: anything out of
 * contract is rejected, except candidate ids outside the closed list, which are dropped (reported in `dropped_ids`;
 * with no valid candidate left, the resolver abstains `no_candidate`).
 */
export function validateVisionOutput(raw: unknown, closedList: Iterable<string>): VisionValidation {
  if (!isPlainObject(raw)) return fail("not_object", "");
  const treeError = scanTree(raw);
  if (treeError !== null) return { ok: false, error: treeError };

  const topError = checkKeys(raw, TOP_KEYS, "");
  if (topError !== null) return { ok: false, error: topError };

  const itemCount = raw["item_count"];
  if (typeof itemCount !== "number" || !Number.isInteger(itemCount)) return fail("wrong_type", "/item_count");
  if (itemCount < 0) return fail("out_of_range", "/item_count");

  const freeLabel = raw["free_label"];
  if (typeof freeLabel !== "string") return fail("wrong_type", "/free_label");
  if (freeLabel.length > FREE_LABEL_MAX) return fail("label_too_long", "/free_label");

  const rawCandidates = raw["candidates"];
  if (!Array.isArray(rawCandidates)) return fail("wrong_type", "/candidates");
  if (rawCandidates.length > MAX_CANDIDATES) return fail("too_many_candidates", "/candidates");

  const allowedIds = new Set(closedList);
  const candidates: VisionCandidateOut[] = [];
  const dropped: string[] = [];
  for (let index = 0; index < rawCandidates.length; index++) {
    const path = `/candidates/${index}`;
    const candidate: unknown = rawCandidates[index];
    if (!isPlainObject(candidate)) return fail("not_object", path);
    const keyError = checkKeys(candidate, CANDIDATE_KEYS, path);
    if (keyError !== null) return { ok: false, error: keyError };
    const itemId = candidate["item_id"];
    const confidence = candidate["confidence"];
    if (typeof itemId !== "string") return fail("wrong_type", `${path}/item_id`);
    if (itemId.length === 0 || itemId.length > ITEM_ID_MAX) return fail("out_of_range", `${path}/item_id`);
    if (typeof confidence !== "number") return fail("wrong_type", `${path}/confidence`);
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
      return fail("out_of_range", `${path}/confidence`);
    }
    if (itemId !== NONE_ITEM_ID && !allowedIds.has(itemId)) {
      dropped.push(itemId);
      continue;
    }
    candidates.push({ item_id: itemId, confidence });
  }

  const rawAttributes = raw["attributes"];
  if (!isPlainObject(rawAttributes)) return fail("not_object", "/attributes");
  const attributeKeyError = checkKeys(rawAttributes, ATTRIBUTE_KEYS, "/attributes");
  if (attributeKeyError !== null) return { ok: false, error: attributeKeyError };
  const booleans = {} as Record<VisionAttributeKey, boolean | null>;
  for (const key of VISION_ATTRIBUTE_KEYS) {
    const value = rawAttributes[key];
    if (value === null || typeof value === "boolean") booleans[key] = value;
    else return fail("wrong_type", `/attributes/${key}`);
  }
  const quality = rawAttributes["image_quality"];
  if (typeof quality !== "string") return fail("wrong_type", "/attributes/image_quality");
  if (!(IMAGE_QUALITIES as readonly string[]).includes(quality)) return fail("out_of_range", "/attributes/image_quality");

  const attributes: VisionAttributes = { ...booleans, image_quality: quality as VisionImageQuality };
  return { ok: true, value: { item_count: itemCount, candidates, free_label: freeLabel, attributes }, dropped_ids: dropped };
}

/** free_label handling (PLAN.md 4.3 [X]): no model text ever leaves the edge or reaches storage. */
export function blankFreeLabel(value: VisionOutput): VisionOutput {
  return { ...value, free_label: "" };
}

/** Validate, then blank `free_label`. The edge function and the browser both use this. */
export function validateAndNormalize(raw: unknown, closedList: Iterable<string>): VisionValidation {
  const result = validateVisionOutput(raw, closedList);
  return result.ok ? { ok: true, value: blankFreeLabel(result.value), dropped_ids: result.dropped_ids } : result;
}

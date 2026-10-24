// Resolver thresholds (PLAN.md 4.4). Values in config/thresholds.json are placeholders, not tuned.
import thresholdsJson from "../../config/thresholds.json";

export interface Thresholds {
  /** Top candidate confidence below this -> `low_confidence`. */
  t_low: number;
  /** Top-2 confidence gap at or below this (with different outcomes) -> `ambiguous_bins`. */
  margin: number;
  /** Where the numbers came from (e.g. "placeholder, not tuned"). */
  provenance: string;
}

export type ThresholdsResult = { ok: true; value: Thresholds } | { ok: false; errors: string[] };

const KEYS = ["t_low", "margin", "provenance"] as const;

function isUnitInterval(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

export function parseThresholds(raw: unknown): ThresholdsResult {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, errors: ["thresholds must be a JSON object"] };
  }
  const record = raw as Record<string, unknown>;
  const errors: string[] = [];
  for (const key of Object.keys(record)) {
    if (!(KEYS as readonly string[]).includes(key)) errors.push(`unknown key "${key}"`);
  }
  const tLow = record["t_low"];
  const margin = record["margin"];
  const provenance = record["provenance"];
  if (!isUnitInterval(tLow)) errors.push("t_low must be a finite number in [0, 1]");
  if (!isUnitInterval(margin) || margin >= 1) errors.push("margin must be a finite number in [0, 1)");
  if (typeof provenance !== "string" || provenance.trim() === "") errors.push("provenance must be a non-empty string");
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: { t_low: tLow as number, margin: margin as number, provenance: provenance as string } };
}

function loadDefaultThresholds(): Thresholds {
  const result = parseThresholds(thresholdsJson);
  if (!result.ok) throw new Error(`config/thresholds.json is invalid: ${result.errors.join("; ")}`);
  return result.value;
}

/** The repository thresholds (config/thresholds.json), validated at module load. */
export const DEFAULT_THRESHOLDS: Thresholds = loadDefaultThresholds();

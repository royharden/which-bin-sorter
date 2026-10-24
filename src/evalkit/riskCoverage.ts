import { isAnswered } from "./types.ts";
import type { Observation } from "./types.ts";
export interface RiskPoint { threshold: number; answered: number; wrong: number; coverage: number; risk: number }
/** Equal-confidence ties enter together; no arbitrary ordering can improve the curve. */
export function riskCoverage(rows: readonly Observation[]): RiskPoint[] {
  const eligible = rows.filter((r) => isAnswered(r.outcome) && r.confidence !== null);
  const thresholds = [...new Set(eligible.map((r) => r.confidence as number))].sort((a, b) => b - a);
  return thresholds.map((threshold) => {
    const subset = eligible.filter((r) => (r.confidence as number) >= threshold);
    const wrong = subset.filter((r) => r.outcome !== r.gold.expected_outcome).length;
    return { threshold, answered: subset.length, wrong, coverage: subset.length / rows.length, risk: wrong / subset.length };
  });
}
/** Highest attainable coverage at or below the target; confidence ties remain intact. */
export function atCoverage(rows: readonly Observation[], target: number): Observation[] {
  if (!Number.isFinite(target) || target < 0 || target > 1) throw new RangeError("coverage target");
  const point = riskCoverage(rows).filter((p) => p.coverage <= target).at(-1);
  return point === undefined ? [] : rows.filter((r) => isAnswered(r.outcome) && r.confidence !== null && r.confidence >= point.threshold);
}

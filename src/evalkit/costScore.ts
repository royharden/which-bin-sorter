import { namedErrors } from "./namedErrors.ts";
import type { Observation } from "./types.ts";
/** Fixed contamination weight 3; unresolved clarifications do not manufacture a bin error. */
export function costScore(rows: readonly Observation[]) {
  const errors = namedErrors(rows);
  const contaminating = errors.filter((e) => e.kind === "contaminating").length;
  const other_wrong = errors.length - contaminating;
  const weighted_errors = 3 * contaminating + other_wrong;
  const allCostsKnown = rows.length > 0 && rows.every((r) => r.cost_usd !== null);
  return { contaminating, other_wrong, weighted_errors, n: rows.length,
    loss: rows.length === 0 ? null : weighted_errors / rows.length,
    cost_per_100: allCostsKnown ? rows.reduce((sum, r) => sum + (r.cost_usd ?? 0), 0) * 100 / rows.length : null };
}

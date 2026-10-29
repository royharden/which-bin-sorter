import { isAnswered } from "./types.ts";
import type { Observation } from "./types.ts";
export interface NamedError { id: string; gold: string; predicted: string; kind: "contaminating" | "other_wrong" }
export function namedErrors(rows: readonly Observation[], recyclingOutcome = "answer:recycling"): NamedError[] {
  return rows.filter((r) => isAnswered(r.outcome) && r.outcome !== r.gold.expected_outcome).map((r) => ({
    id: r.id, gold: r.gold.expected_outcome, predicted: r.outcome,
    kind: r.outcome === recyclingOutcome && r.gold.expected_outcome !== recyclingOutcome ? "contaminating" : "other_wrong",
  }));
}

// 80-id closed-list stress fixture (PLAN.md 4.1): deterministic ids stress_item_001..stress_item_080, sorted.
// Used only by prompt-size and schema-bound tests; never shown in the UI and never part of a rules file.

export const CLOSED_LIST_80_SIZE = 80;

export function stressItemId(n: number): string {
  return `stress_item_${String(n).padStart(3, "0")}`;
}

export const CLOSED_LIST_80: readonly string[] = Object.freeze(
  Array.from({ length: CLOSED_LIST_80_SIZE }, (_unused, index) => stressItemId(index + 1)),
);

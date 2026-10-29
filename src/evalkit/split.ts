/** Stable FNV-1a over UTF-16 code units; grouping is the input, never a photo/query id. */
export function groupHash(group: string, seed: string): number {
  let h = 2166136261;
  for (const char of `${seed}\u0000${group}`) { h ^= char.charCodeAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
export function groupSplit<T>(rows: readonly T[], groupOf: (row: T) => string, seed: string, devFraction = 0.6) {
  if (!(devFraction > 0 && devFraction < 1)) throw new RangeError("dev fraction");
  const dev: T[] = [], heldout: T[] = [];
  for (const row of rows) {
    const group = groupOf(row);
    if (!group.trim()) throw new Error("item group is required, including out-of-table category");
    (groupHash(group, seed) / 4294967296 < devFraction ? dev : heldout).push(row);
  }
  return { dev, heldout, counts: { dev: dev.length, heldout: heldout.length } };
}
export function assertDisjointGroups<T>(dev: readonly T[], heldout: readonly T[], groupOf: (row: T) => string): void {
  const groups = new Set(dev.map(groupOf));
  for (const row of heldout) if (groups.has(groupOf(row))) throw new Error(`split leakage: ${groupOf(row)}`);
}

export interface WilsonInterval { low: number; high: number; n: number; successes: number; z: number }
/** A zero denominator is unavailable, never a zero-width confidence interval. */
export function wilson(successes: number, n: number, z = 1.96): WilsonInterval | null {
  if (!Number.isInteger(n) || !Number.isInteger(successes) || n < 0 || successes < 0 || successes > n || !Number.isFinite(z) || z <= 0) {
    throw new RangeError("invalid Wilson counts or z");
  }
  if (n === 0) return null;
  const p = successes / n;
  const d = 1 + z * z / n;
  const center = (p + z * z / (2 * n)) / d;
  const half = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d;
  return { low: Math.max(0, center - half), high: Math.min(1, center + half), n, successes, z };
}

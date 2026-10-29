import { describe, expect, it } from "vitest";
import { wilson } from "../src/evalkit/wilson.ts";
describe("Wilson 95% interval", () => {
  it.each([[8, 10, 0.49015685, 0.94331905], [0, 10, 0, 0.27754017], [10, 10, 0.72245983, 1]])("matches hand values %i/%i", (k, n, low, high) => {
    const interval = wilson(k, n)!;
    expect(interval.low).toBeCloseTo(low, 6); expect(interval.high).toBeCloseTo(high, 6);
  });
  it("zero is unavailable and impossible counts fail", () => {
    expect(wilson(0, 0)).toBeNull(); expect(() => wilson(11, 10)).toThrow(); expect(() => wilson(0.5, 10)).toThrow();
  });
});

import { describe, expect, it } from "vitest";
import { atCoverage, riskCoverage } from "../src/evalkit/riskCoverage.ts";
import { observation } from "./helpers/evalRows.ts";
describe("risk/coverage", () => {
  it("uses all rows as coverage denominator, preserves ties and excludes unresolved clarify", () => {
    const rows = [observation("a", { confidence: 0.9 }), observation("b", { confidence: 0.9, outcome: "answer:garbage" }),
      observation("c", { confidence: 0.5 }), observation("d", { outcome: "clarify", confidence: 1 })];
    expect(riskCoverage(rows)).toEqual([{ threshold: 0.9, answered: 2, wrong: 1, coverage: 0.5, risk: 0.5 }, { threshold: 0.5, answered: 3, wrong: 1, coverage: 0.75, risk: 1 / 3 }]);
    expect(atCoverage(rows, 0.49)).toEqual([]); expect(atCoverage(rows, 0.5).map((r) => r.id)).toEqual(["a", "b"]);
    expect(riskCoverage([])).toEqual([]);
  });
});

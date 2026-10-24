import { describe, expect, it } from "vitest";
import { costScore } from "../src/evalkit/costScore.ts";
import { namedErrors } from "../src/evalkit/namedErrors.ts";
import { goldRow, observation } from "./helpers/evalRows.ts";
describe("fixed contamination cost", () => {
  it("weights contamination three times, names errors and does not count clarify as answered", () => {
    const rows = [observation("film", { gold: goldRow({ expected_outcome: "answer:drop_off" }) }),
      observation("box", { outcome: "answer:garbage" }), observation("question", { outcome: "clarify" })];
    expect(costScore(rows)).toMatchObject({ contaminating: 1, other_wrong: 1, weighted_errors: 4, n: 3, loss: 4 / 3, cost_per_100: null });
    expect(namedErrors(rows).map((e) => [e.id, e.kind])).toEqual([["film", "contaminating"], ["box", "other_wrong"]]);
    expect(costScore([]).loss).toBeNull();
    expect(costScore(rows.map((r) => ({ ...r, cost_usd: 0.02 }))).cost_per_100).toBeCloseTo(2);
  });
});

import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { buildReport, buildLimitations, METHODS } from "../scripts/eval/report.ts";
import { parseManifest } from "../scripts/eval/manifest.ts";
import { runMethods } from "../scripts/eval/runner.ts";
import { validateFixtureCache } from "../scripts/eval/cache.ts";
import type { FixtureCache } from "../scripts/eval/cache.ts";
import { parseEvalArgs } from "../scripts/eval.ts";
import { tuneThresholds } from "../scripts/tune-thresholds.ts";
import { systemObservation } from "../scripts/baselines/system.ts";
import { rawFixture, TEST_RULES_VERSION, TEST_THRESHOLDS } from "./helpers/fixtureRules.ts";
import { observation } from "./helpers/evalRows.ts";
describe("offline fixture report source contract", () => {
  const rules = rawFixture();
  const read = (name: string): string => readFileSync(new URL(`../eval/${name}`, import.meta.url), "utf8");
  const photos = () => parseManifest(read("fixtures/manifest.fixture.jsonl"), rules);
  const input = () => ({ photos: photos(), text: parseManifest(read("text/queries.dev.jsonl"), rules), rules, version: TEST_RULES_VERSION, thresholds: TEST_THRESHOLDS, fixture: true });
  it("feeds authored cache through real methods to pure md/jsonl content, without network", async () => {
    const network = vi.fn(() => { throw new Error("network forbidden"); });
    vi.stubGlobal("fetch", network);
    try {
      const rows = await runMethods(input(), async (method, gold) => {
        const cache = validateFixtureCache(JSON.parse(read(`fixtures/cache/${method}/${gold.photo_id}.json`)) as FixtureCache, method, gold.photo_id);
        return { raw: cache.raw, provenance: cache.provenance, cost_usd: null, latency_ms: null };
      });
      const report = buildReport(rows);
      expect(network).not.toHaveBeenCalled();
      expect(rows.map((r) => r.method)).toEqual([...METHODS]);
      expect(report.md.toLowerCase()).toContain("not yet measured");
      expect(report.md).toContain("95% Wilson"); expect(report.md).toContain("| clip | photo | not run |");
      expect(report.md).toContain("| T2 | text | not run |"); expect(report.md).toContain("not evaluated / not included");
      const records = report.jsonl.trim().split("\n").map((line) => JSON.parse(line) as { type: string; method?: string; metrics?: { answered: number; wrong_wilson: unknown } });
      const system = records.find((r) => r.type === "method" && r.method === "system");
      expect(system?.metrics?.answered).toBe(2); expect(system?.metrics?.wrong_wilson).not.toBeNull();
      expect(rows.find((r) => r.method === "T1")?.observations).toHaveLength(36);
      expect(buildLimitations(rows, { run_id: "test", mode: "fixture", split: "dev", real_photo_count: 0 })).toContain("not yet measured");
      expect(() => buildReport(rows, { run_id: "test", mode: "live", split: "dev", real_photo_count: 8 })).toThrow("mock provenance");
    } finally { vi.unstubAllGlobals(); }
  });
  it("fails on an offline cache miss rather than supplying zero predictions", async () => {
    await expect(runMethods(input(), async () => { throw new Error("offline cache miss"); })).rejects.toThrow("cache miss");
    expect(parseEvalArgs(["--offline", "--fixture"]).manifest).toContain("manifest.fixture.jsonl");
    expect(() => parseEvalArgs(["--offline", "--live"])).toThrow("exactly");
  });
  it("labels unequal tie-preserving coverage floors as an unavailable comparison in report prose", () => {
    const system = [observation("a", { confidence: 0.9 }), observation("b", { confidence: 0.9 }),
      observation("c", { confidence: 0.8 }), observation("d", { outcome: "abstain" })];
    const other = [observation("a", { confidence: 0.9 }), observation("b", { confidence: 0.8 }),
      observation("c", { confidence: 0.8 }), observation("d", { confidence: 0.8 })];
    const report = buildReport([
      { method: "system", track: "photo", status: "complete", observations: system, expected_n: 4, note: "" },
      { method: "rules-in-prompt", track: "photo", status: "complete", observations: other, expected_n: 4, note: "" },
    ]);
    expect(report.md).toContain("equal-coverage comparison unavailable (unequal_attained_coverage)");
    expect(report.md).toContain("attained 75.0% / 25.0%");
  });
  it("the no-abstain ablation removes confidence/quality gates but preserves multiple/unresolvable", () => {
    const get = (id: string) => JSON.parse(read(`fixtures/cache/system/${id}.json`)) as FixtureCache;
    const evaluate = (id: string) => systemObservation(photos().find((g) => g.photo_id === id)!, get(id).raw, rules, TEST_RULES_VERSION, TEST_THRESHOLDS, "mock", true);
    expect(evaluate("low_confidence").outcome).toBe("answer:recycling");
    expect(evaluate("blurry").outcome).toBe("answer:recycling");
    expect(evaluate("two_items").outcome).toBe("abstain");
    expect(evaluate("pizza_box_greasy").outcome).toBe("clarify");
  });
  it("tunes dev only, reports infeasible coverage and breaks exact ties by fixed grid order", () => {
    const gold = photos().find((r) => r.photo_id === "cardboard_box")!;
    const cached = JSON.parse(read("fixtures/cache/system/cardboard_box.json")) as FixtureCache;
    const sample = { gold, raw: cached.raw, provenance: "mock" };
    const grid = [{ t_low: 0.8, margin: 0.1, provenance: "test first" }, { t_low: 0.9, margin: 0.1, provenance: "test second" }];
    expect(tuneThresholds([sample], rules, TEST_RULES_VERSION, grid).selected?.index).toBe(0);
    expect(tuneThresholds([sample], rules, TEST_RULES_VERSION, [{ t_low: 1, margin: 0, provenance: "test" }]).status).toBe("infeasible");
    expect(() => tuneThresholds([{ ...sample, gold: { ...gold, split: "heldout" } }], rules, TEST_RULES_VERSION)).toThrow("dev-only");
  });
});

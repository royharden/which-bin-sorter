import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { sha256Hex } from "../src/core/hash.ts";
import { main } from "../scripts/eval.ts";
import * as live from "../scripts/eval/live.ts";
import { plannedCalls } from "../scripts/eval/runner.ts";
import type { MethodRow } from "../scripts/eval/report.ts";
import { goldRow } from "./helpers/evalRows.ts";
import { rawFixture, TEST_RULES_VERSION, TEST_THRESHOLDS } from "./helpers/fixtureRules.ts";
import { buildJpeg } from "./helpers/jpeg.ts";

// Activation-only filesystem receipts are deliberately retained. These synthetic JPEG bytes are headers,
// never real/decoded pixels, and transport is replaced before the CLI can run.
async function setup() {
  const root = mkdtempSync(path.join(tmpdir(), "s31-preflight-test-"));
  const at = (relative: string): string => path.join(root, relative);
  const write = (relative: string, value: string | Uint8Array): void => {
    mkdirSync(path.dirname(at(relative)), { recursive: true });
    writeFileSync(at(relative), value, { flag: "wx" });
  };
  const rules = rawFixture();
  const bytes = buildJpeg({ width: 1, height: 1 });
  const photo = goldRow({ photo_id: "synthetic_header", file: "synthetic-header.jpg", sha256: await sha256Hex(bytes),
    split: "heldout", licence: "synthetic-header-test-only" });
  const dev = goldRow({ photo_id: "dev_text", query: "cardboard box" });
  const heldout = goldRow({ photo_id: "heldout_text", item_id: "pizza_box", item_group: "pizza_box", rule_id: "pizza_box",
    expected_outcome: "clarify", query: "pizza box", split: "heldout" });
  const model = { provider: "anthropic", status: "configured", model_id: "test-only-pinned-id" };
  const prices = { status: "verified", entries: [{ model_id: model.model_id, input_usd_per_mtok: 1, output_usd_per_mtok: 1,
    as_of: "2026-10-24", source_url: "https://fixture.example.invalid/test-price" }] };
  const runtime = { max_tokens: 400, provider_timeout_ms: 100, max_image_tokens: 1600 };
  const env = { LIVE_MODEL_ENABLED: "true", ANTHROPIC_API_KEY: "test-only-not-a-key" };
  const config = live.liveConfig(model, prices, runtime, env, true);
  const input = { photos: [photo], text: [heldout], rules, version: TEST_RULES_VERSION, thresholds: TEST_THRESHOLDS, fixture: false };
  const bounds = plannedCalls(input).map((c) => live.callBound(c.prompt, config, c.method !== "T2"));
  for (const [relative, value] of [
    ["rules/fixture-city.json", rules], ["config/thresholds.json", TEST_THRESHOLDS],
    ["config/model.json", model], ["config/prices.json", prices], ["config/runtime.json", runtime],
  ] as const) write(relative, JSON.stringify(value));
  write("eval/manifest.jsonl", JSON.stringify(photo) + "\n");
  write("eval/text/queries.dev.jsonl", JSON.stringify(dev) + "\n");
  write("eval/text/queries.heldout.jsonl", JSON.stringify(heldout) + "\n");
  write("eval/photos/synthetic-header.jpg", bytes);
  return { root, at, write, bounds, env };
}

describe("CLI aggregate preflight stop", () => {
  const args = ["--live", "--split", "heldout", "--confirm-heldout-once", "--out", "results/preflight-stop",
    "--limitations", "results/preflight-stop/LIMITATIONS.md"];
  it("writes incomplete md/jsonl, returns 1 and dispatches nothing without consuming heldout", async () => {
    const fixture = await setup();
    // Each call alone fits, but the aggregate plan does not. This must stop before entering live dispatch.
    const cap = Math.max(...fixture.bounds);
    expect(fixture.bounds.every((b) => b <= cap)).toBe(true);
    expect(fixture.bounds.reduce((sum, b) => sum + b, 0)).toBeGreaterThan(cap);
    const dispatch = vi.spyOn(live, "dispatch").mockRejectedValue(new Error("unexpected paid dispatch"));
    const network = vi.fn(() => { throw new Error("network forbidden"); });
    vi.stubGlobal("fetch", network);
    for (const [key, value] of Object.entries(fixture.env)) vi.stubEnv(key, value);
    vi.stubEnv("EVAL_BUDGET_USD", String(cap));
    try {
      expect(await main(args, fixture.root)).toBe(1);
      expect(dispatch).not.toHaveBeenCalled(); expect(network).not.toHaveBeenCalled();
      expect(existsSync(fixture.at("results/heldout.lock"))).toBe(false);
      expect(existsSync(fixture.at("eval/ledger.jsonl"))).toBe(false);
      expect(existsSync(fixture.at("eval/budget.lock"))).toBe(false);
      const md = readFileSync(fixture.at("results/preflight-stop/results.md"), "utf8");
      expect(md).toContain("Preflight budget stop: preflight exceeds EVAL_BUDGET_USD");
      const records = readFileSync(fixture.at("results/preflight-stop/results.jsonl"), "utf8").trim().split("\n")
        .map((line) => JSON.parse(line) as MethodRow & { type: string; claim_established?: boolean });
      expect(records.find((r) => r.type === "run")?.claim_established).toBe(false);
      for (const method of ["system", "no-abstain", "generic-map", "rules-in-prompt", "rules-in-prompt-unsure", "T2"]) {
        const row = records.find((r) => r.type === "method" && r.method === method);
        expect(row).toMatchObject({ status: "incomplete", expected_n: 1, observations: [] });
        expect(row?.note).toContain("Preflight budget stop");
      }
      for (const method of ["typed-oracle", "T1"]) expect(records.find((r) => r.type === "method" && r.method === method))
        .toMatchObject({ status: "complete", expected_n: 1, observations: [expect.any(Object)] });
      expect(readFileSync(fixture.at("results/preflight-stop/LIMITATIONS.md"), "utf8")).toContain("system: incomplete; Preflight budget stop");
    } finally { dispatch.mockRestore(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); }
  });
  it.each(["invalid-budget", "occupied-lock"] as const)("does not turn %s into an expected incomplete report", async (failure) => {
    const fixture = await setup();
    const dispatch = vi.spyOn(live, "dispatch").mockRejectedValue(new Error("unexpected paid dispatch"));
    for (const [key, value] of Object.entries(fixture.env)) vi.stubEnv(key, value);
    vi.stubEnv("EVAL_BUDGET_USD", failure === "invalid-budget" ? "not-a-budget" : "100");
    if (failure === "occupied-lock") fixture.write("eval/budget.lock", "synthetic-occupied-lock\n");
    try {
      await expect(main(args, fixture.root)).rejects.toThrow(failure === "invalid-budget" ? "positive explicit budget" : /EEXIST/);
      expect(dispatch).not.toHaveBeenCalled();
      expect(existsSync(fixture.at("results/heldout.lock"))).toBe(false);
      expect(existsSync(fixture.at("results/preflight-stop/results.md"))).toBe(false);
      expect(existsSync(fixture.at("results/preflight-stop/results.jsonl"))).toBe(false);
    } finally { dispatch.mockRestore(); vi.unstubAllEnvs(); }
  });
});

import { describe, expect, it } from "vitest";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { cacheKey, validateCache } from "../scripts/eval/cache.ts";
import type { CacheIdentity } from "../scripts/eval/cache.ts";
import { committedSpend, lockHeldout, openBudgetSession, preflight } from "../scripts/eval/budget.ts";
import type { LedgerEvent, BudgetSession } from "../scripts/eval/budget.ts";
import { dispatch, liveConfig } from "../scripts/eval/live.ts";
import type { EvalLiveConfig } from "../scripts/eval/live.ts";
const identity: CacheIdentity = { provider: "anthropic", model_id: "test-only-pinned-id", method_id: "system", prompt_hash: "p", rules_content_hash: "r", closed_list_hash: "c", vision_schema_version: 1, preprocessing_version: "jpeg-1024-v1", upload_sha256: "u" };
describe("exact evaluation identity", () => {
  it("changes the key for every one of the nine identity fields", async () => {
    const base = await cacheKey(identity);
    for (const key of Object.keys(identity) as (keyof CacheIdentity)[]) {
      const changed = { ...identity, [key]: key === "vision_schema_version" ? 2 : `${identity[key]}changed` };
      expect(await cacheKey(changed)).not.toBe(base);
    }
    expect(await cacheKey({ ...identity })).toBe(base);
  });
  it("refuses stale identity, mock provenance and extra identity fields", () => {
    const record = { identity, provenance: "mock", raw: {}, cost_usd: null, latency_ms: null };
    expect(() => validateCache(record, identity, "live")).toThrow("mock");
    expect(() => validateCache(record, { ...identity, method_id: "other" }, "fixture")).toThrow("identity mismatch");
    expect(() => validateCache({ ...record, identity: { ...identity, extra: "x" } as CacheIdentity }, identity, "fixture")).toThrow("exactly nine");
  });
  it("preflights all planned calls and retains uncertain or interrupted reservations", () => {
    const events: LedgerEvent[] = [{ type: "reserve", run_id: "test", call_id: "a", worst_usd: 0.04, at: "test" }];
    expect(() => preflight(events, [0.04, 0.04], 0.1)).toThrow("preflight");
    expect(committedSpend([...events, { type: "settle", call_id: "a", status: "uncertain", cost_usd: null, at: "test" }])).toBe(0.04);
    expect(committedSpend([...events, { type: "settle", call_id: "a", status: "settled", cost_usd: 0.01, at: "test" }])).toBe(0.01);
    expect(() => preflight([], [0.01], Number.NaN)).toThrow("explicit budget");
  });
  it("owns an exclusive lock, checks each reservation and permanently locks heldout once", () => {
    // Activation-only temporary receipts deliberately retained; no source artifact is deleted.
    const dir = mkdtempSync(path.join(tmpdir(), "s31-eval-test-"));
    const ledger = path.join(dir, "ledger.jsonl"), lock = path.join(dir, "budget.lock");
    const session = openBudgetSession(ledger, lock, "one", [0.06], 0.1);
    expect(() => openBudgetSession(ledger, lock, "two", [], 0.1)).toThrow();
    const id = session.reserve(0.06); session.settle(id, null);
    expect(() => session.reserve(0.06)).toThrow("preflight"); session.close();
    expect(existsSync(lock)).toBe(false); // released lock is archived, not removed
    const heldout = path.join(dir, "heldout.lock"), metadata = { run_id: "test", manifest_digest: "m", methods_digest: "m", config_digest: "c" };
    expect(() => lockHeldout(heldout, false, metadata)).toThrow("confirm-heldout-once");
    expect(existsSync(heldout)).toBe(false); lockHeldout(heldout, true, metadata);
    expect(() => lockHeldout(heldout, true, metadata)).toThrow();
  });
  it("dispatch reserves before transport and disabled live config refuses unconfigured model/prices", async () => {
    const order: string[] = [];
    const budget: BudgetSession = { reserve: () => { order.push("reserve"); return "call"; }, settle: () => { order.push("settle"); }, close: () => undefined };
    const config: EvalLiveConfig = { apiKey: "test-only-not-a-key", modelId: "test-only-pinned-id", maxTokens: 400, timeoutMs: 100,
      maxImageTokens: 1600, price: { model_id: "test-only-pinned-id", input_usd_per_mtok: 1, output_usd_per_mtok: 1, as_of: "2026-10-24", source_url: "https://fixture.example.invalid/price" } };
    const transport: typeof fetch = async () => { order.push("fetch"); return new Response(JSON.stringify({ model: config.modelId, content: [{ type: "text", text: "{}" }], usage: { input_tokens: 10, output_tokens: 2 } }), { status: 200 }); };
    const result = await dispatch({ system: "test", user: "test" }, null, config, budget, transport);
    expect(order).toEqual(["reserve", "fetch", "settle"]); expect(result.cost_usd).toBe(12 / 1e6);
    expect(() => liveConfig({}, {}, {}, {}, false)).toThrow("disabled");
    expect(() => liveConfig({ provider: "anthropic", model_id: null }, { status: "unverified", entries: [] }, {}, { LIVE_MODEL_ENABLED: "true" }, true)).toThrow("unconfigured");
  });
});

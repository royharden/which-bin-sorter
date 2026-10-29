import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { canonicalJson, sha256Hex } from "../src/core/hash.ts";
import type { RulesFile } from "../src/core/rules.ts";
import type { GoldRow } from "../src/evalkit/types.ts";
import type { Thresholds } from "../src/core/thresholds.ts";
import { metrics } from "../src/evalkit/metrics.ts";
import { systemObservation } from "./baselines/system.ts";
import { buildIdentifyPrompt } from "../supabase/functions/identify/prompt.ts";
import { SCHEMA_VERSION, PREPROCESSING_VERSION } from "../supabase/functions/identify/visionSchema.ts";
import { cacheKey, validateCache, validateFixtureCache } from "./eval/cache.ts";
import type { CacheIdentity, CacheRecord, FixtureCache } from "./eval/cache.ts";
import { parseManifest } from "./eval/manifest.ts";
export interface TuneSample { gold: GoldRow; raw: unknown; provenance: string }
export const FIXED_GRID: readonly Thresholds[] = [0.5, 0.6, 0.7, 0.8, 0.9].flatMap((t_low) => [0, 0.05, 0.1, 0.15, 0.2].map((margin) => ({ t_low, margin, provenance: "dev grid candidate; not yet tuned" })));
export function tuneThresholds(samples: readonly TuneSample[], rules: RulesFile, version: string, grid = FIXED_GRID) {
  if (samples.length === 0 || samples.some((s) => s.gold.split !== "dev")) throw new Error("nonempty dev-only tuning required");
  const candidates = grid.map((thresholds, index) => {
    const score = metrics(samples.map((s) => systemObservation(s.gold, s.raw, rules, version, thresholds, s.provenance)));
    return { thresholds, index, coverage: score.coverage.value!, loss: score.cost.loss! };
  });
  const feasible = candidates.filter((c) => c.coverage >= 0.6).sort((a, b) => a.loss - b.loss || b.coverage - a.coverage || a.index - b.index);
  return { status: feasible.length === 0 ? "infeasible" : "selected", selected: feasible[0] ?? null, coverage_floor: 0.6, contamination_weight: 3, candidates, n: samples.length };
}
export async function main(args: readonly string[]): Promise<number> {
  let fixture = false, manifest = "eval/manifest.jsonl", out = "results/threshold-tuning.json", rulesFile = "rules/fixture-city.json";
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (key === "--fixture") fixture = true;
    else if (["--manifest", "--out", "--rules", "--split"].includes(key ?? "")) {
      const value = args[++i]; if (!value || value.startsWith("--")) throw new Error(`missing ${key}`);
      if (key === "--split" && value !== "dev") throw new Error("never tune heldout");
      if (key === "--manifest") manifest = value;
      if (key === "--out") out = value;
      if (key === "--rules") rulesFile = value;
    } else throw new Error(`unknown tune option ${key}`);
  }
  if (existsSync("results/heldout.lock")) throw new Error("tuning locked after heldout exposure");
  if (fixture && manifest === "eval/manifest.jsonl") manifest = "eval/fixtures/manifest.fixture.jsonl";
  const rules = JSON.parse(readFileSync(rulesFile, "utf8")) as RulesFile;
  const version = await sha256Hex(canonicalJson(rules));
  const gold = parseManifest(readFileSync(manifest, "utf8"), rules).filter((r) => r.split === "dev");
  if (gold.some((r) => (r.licence === "fixture") !== fixture)) throw new Error("tuning manifest provenance mismatch");
  const model = JSON.parse(readFileSync("config/model.json", "utf8")) as { provider: string; model_id: string | null };
  const samples: TuneSample[] = [];
  for (const row of gold) {
    if (fixture) {
      const cache = validateFixtureCache(JSON.parse(readFileSync(`eval/fixtures/cache/system/${row.photo_id}.json`, "utf8")) as FixtureCache, "system", row.photo_id);
      samples.push({ gold: row, raw: cache.raw, provenance: cache.provenance });
    } else {
      if (!model.model_id || !row.sha256) throw new Error("configured model and normalized photo hash required");
      const identity: CacheIdentity = { provider: model.provider, model_id: model.model_id, method_id: "system", prompt_hash: await sha256Hex(canonicalJson(buildIdentifyPrompt(rules.entries.map((e) => e.id).sort()))), rules_content_hash: version,
        closed_list_hash: await sha256Hex(rules.entries.map((e) => e.id).sort().join("\n")), vision_schema_version: SCHEMA_VERSION, preprocessing_version: PREPROCESSING_VERSION, upload_sha256: row.sha256 };
      const cache = validateCache(JSON.parse(readFileSync(`eval/cache/system/${await cacheKey(identity)}.json`, "utf8")) as CacheRecord, identity, "live");
      samples.push({ gold: row, raw: cache.raw, provenance: cache.provenance });
    }
  }
  const report = tuneThresholds(samples, rules, version);
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify({ ...report, rules_hash: version, note: fixture ? "Authored fixtures only; not a real tuned threshold." : "Dev only; review before promoting config." }, null, 2) + "\n", { flag: "wx" });
  return report.status === "infeasible" ? 1 : 0;
}
const invoked = process.argv[1];
if (invoked !== undefined && import.meta.url === pathToFileURL(path.resolve(invoked)).href) main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (e: unknown) => { console.error(e instanceof Error ? e.message : "tuning failed"); process.exitCode = 2; });

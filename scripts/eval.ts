import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { canonicalJson, sha256Hex } from "../src/core/hash.ts";
import type { RulesFile } from "../src/core/rules.ts";
import { parseThresholds } from "../src/core/thresholds.ts";
import { SCHEMA_VERSION, PREPROCESSING_VERSION } from "../supabase/functions/identify/visionSchema.ts";
import { parseManifest } from "./eval/manifest.ts";
import { assertDisjointGroups } from "../src/evalkit/split.ts";
import { buildReport, buildLimitations, METHODS } from "./eval/report.ts";
import type { MethodRow, ReportContext } from "./eval/report.ts";
import { cacheKey, validateCache, validateFixtureCache } from "./eval/cache.ts";
import type { CacheIdentity, CacheRecord, FixtureCache } from "./eval/cache.ts";
import { runMethods, plannedCalls } from "./eval/runner.ts";
import type { RunInput, Replay, PaidMethod } from "./eval/runner.ts";
import { liveConfig, callBound, dispatch } from "./eval/live.ts";
import { BudgetStop, openBudgetSession, lockHeldout } from "./eval/budget.ts";
import type { BudgetSession } from "./eval/budget.ts";
import type { GoldRow } from "../src/evalkit/types.ts";
import { preparedJpegDimensions } from "./eval/jpeg.ts";

export interface EvalOptions { offline: boolean; live: boolean; fixture: boolean; split: "dev" | "heldout"; confirmHeldout: boolean; manifest: string; rules: string; out: string; limitations: string | null }
export function parseEvalArgs(args: readonly string[]): EvalOptions {
  const result: EvalOptions = { offline: false, live: false, fixture: false, split: "dev", confirmHeldout: false, manifest: "eval/manifest.jsonl", rules: "rules/fixture-city.json", out: "results", limitations: null };
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (key === "--offline") result.offline = true;
    else if (key === "--live") result.live = true;
    else if (key === "--fixture") result.fixture = true;
    else if (key === "--confirm-heldout-once") result.confirmHeldout = true;
    else if (["--split", "--manifest", "--rules", "--out", "--limitations"].includes(key ?? "")) {
      const value = args[++i];
      if (value === undefined || value.startsWith("--")) throw new Error(`missing ${key} value`);
      if (key === "--split") { if (value !== "dev" && value !== "heldout") throw new Error("split must be dev|heldout"); result.split = value; }
      if (key === "--manifest") result.manifest = value;
      if (key === "--rules") result.rules = value;
      if (key === "--out") result.out = value;
      if (key === "--limitations") result.limitations = value;
    } else throw new Error(`unknown eval option: ${key}`);
  }
  if (result.offline === result.live) throw new Error("choose exactly --offline or --live");
  if (result.fixture && !result.offline) throw new Error("fixtures are offline only");
  if (result.fixture && result.manifest === "eval/manifest.jsonl") result.manifest = "eval/fixtures/manifest.fixture.jsonl";
  return result;
}
const json = (file: string): unknown => JSON.parse(readFileSync(file, "utf8"));
function contained(root: string, relative: string): string {
  const full = path.resolve(root, relative), base = path.resolve(root) + path.sep;
  if (!full.startsWith(base)) throw new Error("photo path must remain within eval/photos");
  return full;
}
export async function main(args: readonly string[], root = process.cwd()): Promise<number> {
  const options = parseEvalArgs(args);
  const at = (file: string): string => path.resolve(root, file);
  for (const file of [`${options.out}/results.md`, `${options.out}/results.jsonl`, ...(options.limitations === null ? [] : [options.limitations])]) {
    if (existsSync(at(file))) throw new Error(`refuse report overwrite: ${file}`);
  }
  const rules = json(at(options.rules)) as RulesFile;
  const thresholdResult = parseThresholds(json(at("config/thresholds.json")));
  if (!thresholdResult.ok) throw new Error(thresholdResult.errors.join("; "));
  const manifestText = readFileSync(at(options.manifest), "utf8");
  const allPhotos = parseManifest(manifestText, rules);
  const photos = allPhotos.filter((r) => r.split === options.split);
  if (photos.some((r) => (r.licence === "fixture") !== options.fixture || r.query !== undefined)) throw new Error("manifest track/provenance mismatch");
  const devText = parseManifest(readFileSync(at("eval/text/queries.dev.jsonl"), "utf8"), rules);
  const heldoutText = parseManifest(readFileSync(at("eval/text/queries.heldout.jsonl"), "utf8"), rules);
  assertDisjointGroups(devText, heldoutText, (r) => r.item_group);
  const text = options.split === "dev" ? devText : heldoutText;
  if (devText.some((r) => r.split !== "dev" || r.query === undefined) || heldoutText.some((r) => r.split !== "heldout" || r.query === undefined)) throw new Error("text track split/query mismatch");
  const version = await sha256Hex(canonicalJson(rules));
  const closed = await sha256Hex(rules.entries.map((e) => e.id).sort().join("\n"));
  const input: RunInput = { photos, text, rules, version, thresholds: thresholdResult.value, fixture: options.fixture };
  const runId = randomUUID();
  const configs = { model: json(at("config/model.json")), prices: json(at("config/prices.json")), runtime: json(at("config/runtime.json")), thresholds: thresholdResult.value };
  const digests = { manifest_digest: await sha256Hex(manifestText + canonicalJson(text)), methods_digest: await sha256Hex(canonicalJson(METHODS)), config_digest: await sha256Hex(canonicalJson({ ...configs, rules: version, schema: SCHEMA_VERSION, preprocessing: PREPROCESSING_VERSION })) };
  // Offline real-cache replay needs configured identities, but never an API key or live enable flag.
  const config = options.fixture ? null : options.live ? liveConfig(configs.model, configs.prices, configs.runtime, process.env, true) : null;
  const model = configs.model as { model_id?: string; provider?: string };
  const modelId = config?.modelId ?? model.model_id;
  if (!options.fixture && (!modelId || model.provider !== "anthropic")) throw new Error("exact configured model identity required for real-cache replay");
  const cachePlans = await Promise.all(plannedCalls(input).filter((c) => !(options.fixture && c.method === "T2")).map(async (call) => {
    const identity: CacheIdentity = { provider: model.provider ?? "anthropic", model_id: modelId ?? "fixture", method_id: call.method, prompt_hash: await sha256Hex(canonicalJson(call.prompt)), rules_content_hash: version, closed_list_hash: closed, vision_schema_version: SCHEMA_VERSION, preprocessing_version: call.method === "T2" ? "text-v1" : PREPROCESSING_VERSION,
      upload_sha256: call.method === "T2" ? await sha256Hex(call.gold.query ?? "") : call.gold.sha256 ?? "fixture" };
    const file = options.fixture ? at(`eval/fixtures/cache/${call.method}/${call.gold.photo_id}.json`) : at(`eval/cache/${call.method}/${await cacheKey(identity)}.json`);
    let cached: Replay | null = null;
    if (existsSync(file)) {
      if (options.fixture) { const c = validateFixtureCache(json(file) as FixtureCache, call.method, call.gold.photo_id); cached = { raw: c.raw, provenance: c.provenance, cost_usd: null, latency_ms: null }; }
      else { const c = validateCache(json(file) as CacheRecord, identity, "live"); cached = c; }
    } else if (options.offline) throw new Error(`offline cache miss: ${file}`);
    return { ...call, identity, file, cached };
  }));
  const byCall = new Map(cachePlans.map((c) => [`${c.method}/${c.gold.photo_id}`, c]));
  // Verify every real upload before reserving money or consuming the heldout lock.
  const images = new Map<string, string>();
  if (options.live) for (const photo of photos) {
    if (photo.file === null) throw new Error("live requires real normalized images");
    const bytes = readFileSync(contained(at("eval/photos"), photo.file));
    if (await sha256Hex(bytes) !== photo.sha256) throw new Error(`photo hash mismatch: ${photo.photo_id}`);
    preparedJpegDimensions(bytes);
    images.set(photo.photo_id, bytes.toString("base64"));
  }
  mkdirSync(at(options.out), { recursive: true });
  const context: ReportContext = { run_id: runId, mode: options.fixture ? "fixture" : "live", split: options.split, real_photo_count: options.fixture ? 0 : photos.length, digests };
  const emitReport = (rows: readonly MethodRow[]): void => {
    const report = buildReport(rows, context);
    // No silent overwrite of a prior report or limitations artifact.
    writeFileSync(at(`${options.out}/results.md`), report.md, { flag: "wx" });
    writeFileSync(at(`${options.out}/results.jsonl`), report.jsonl, { flag: "wx" });
    if (options.limitations !== null) writeFileSync(at(options.limitations), buildLimitations(rows, context), { flag: "wx" });
  };
  let budget: BudgetSession | null = null;
  try {
    if (config !== null) {
      try {
        budget = openBudgetSession(at("eval/ledger.jsonl"), at("eval/budget.lock"), runId,
          cachePlans.filter((c) => c.cached === null).map((c) => callBound(c.prompt, config, c.method !== "T2")), Number(process.env.EVAL_BUDGET_USD));
      } catch (error) {
        if (!(error instanceof BudgetStop)) throw error; // bad configuration/lock errors remain CLI failures
        // Use the shared method/report path with a loader that cannot dispatch. Deterministic rows remain useful.
        const reason = `Preflight budget stop: ${error.message}`;
        const rows = await runMethods(input, async () => { throw error; }, { stopOnError: true });
        for (const row of rows) if (row.status === "incomplete") row.note = reason;
        emitReport(rows);
        return 1;
      }
    }
    // A rejected budget preflight never consumes the single-use heldout lock.
    if (options.split === "heldout") lockHeldout(at("results/heldout.lock"), options.confirmHeldout, { run_id: runId, ...digests });
    const load = async (method: PaidMethod, gold: GoldRow): Promise<Replay> => {
      const plan = byCall.get(`${method}/${gold.photo_id}`);
      if (plan === undefined) throw new Error("unplanned call");
      if (plan.cached !== null) return plan.cached;
      if (config === null || budget === null || !options.live) throw new Error("offline cache miss");
      const response = await dispatch(plan.prompt, method === "T2" ? null : images.get(gold.photo_id) ?? null, config, budget);
      if (response.error !== null) throw new Error(response.error);
      const record: CacheRecord = { identity: plan.identity, raw: response.raw, provenance: response.provenance, cost_usd: response.cost_usd, latency_ms: response.latency_ms };
      mkdirSync(path.dirname(plan.file), { recursive: true });
      writeFileSync(plan.file, JSON.stringify(record) + "\n", { flag: "wx" });
      return record;
    };
    const rows = await runMethods(input, load, { stopOnError: options.live });
    emitReport(rows);
    return rows.some((r) => r.status === "incomplete") ? 1 : 0;
  } finally { budget?.close(); }
}
const invoked = process.argv[1];
if (invoked !== undefined && import.meta.url === pathToFileURL(path.resolve(invoked)).href) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (error: unknown) => { console.error(error instanceof Error ? error.message : "evaluation failed"); process.exitCode = 2; });
}

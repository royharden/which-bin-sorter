import type { RulesFile } from "../../src/core/rules.ts";
import type { Thresholds } from "../../src/core/thresholds.ts";
import type { GoldRow, Observation } from "../../src/evalkit/types.ts";
import { buildIdentifyPrompt } from "../../supabase/functions/identify/prompt.ts";
import type { IdentifyPrompt } from "../../supabase/functions/identify/prompt.ts";
import { genericObservation, genericPrompt } from "../baselines/generic-map.ts";
import { rulesObservation, rulesPrompt } from "../baselines/rules-in-prompt.ts";
import { systemObservation } from "../baselines/system.ts";
import { textResolver, typedOracle } from "../baselines/typed.ts";
import { textPickerObservation, textPickerPrompt } from "../baselines/text-picker.ts";
import { clipBaseline } from "../baselines/clip.ts";
import { METHODS } from "./report.ts";
import type { MethodId, MethodRow } from "./report.ts";

export const PAID_METHODS = ["system", "generic-map", "rules-in-prompt", "rules-in-prompt-unsure", "T2"] as const;
export type PaidMethod = typeof PAID_METHODS[number];
export interface Replay { raw: unknown; provenance: string; cost_usd: number | null; latency_ms: number | null }
export interface RunInput { photos: GoldRow[]; text: GoldRow[]; rules: RulesFile; version: string; thresholds: Thresholds; fixture: boolean }
export function promptFor(method: PaidMethod, gold: GoldRow, rules: RulesFile): IdentifyPrompt {
  switch (method) {
    case "system": return buildIdentifyPrompt(rules.entries.map((e) => e.id).sort());
    case "generic-map": return genericPrompt();
    case "rules-in-prompt": return rulesPrompt(rules, false);
    case "rules-in-prompt-unsure": return rulesPrompt(rules, true);
    case "T2": return textPickerPrompt(gold.query ?? "", rules);
  }
}
export function plannedCalls(input: RunInput): { method: PaidMethod; gold: GoldRow; prompt: IdentifyPrompt }[] {
  return PAID_METHODS.flatMap((method) => (method === "T2" ? input.text : input.photos).map((gold) => ({ method, gold, prompt: promptFor(method, gold, input.rules) })));
}
/** Offline and live share the exact same interpretation/report path. Loader is the only I/O seam. */
export async function runMethods(input: RunInput, load: (method: PaidMethod, gold: GoldRow, prompt: IdentifyPrompt) => Promise<Replay>, options: { stopOnError?: boolean } = {}): Promise<MethodRow[]> {
  const rows = new Map<MethodId, MethodRow>(METHODS.map((method) => [method, { method, track: method.startsWith("T") ? "text" : "photo", status: "complete", observations: [], note: "", expected_n: method.startsWith("T") ? input.text.length : input.photos.length }]));
  const row = (method: MethodId): MethodRow => rows.get(method)!;
  row("clip").status = clipBaseline().status;
  row("clip").note = clipBaseline().reason;
  row("T3").status = "not evaluated / not included";
  row("T3").note = "Jev adapter is not included.";
  if (input.fixture) { row("T2").status = "not run"; row("T2").note = "Closed-list text-model picker is live only."; }
  for (const gold of input.photos) row("typed-oracle").observations.push(typedOracle(gold, input.rules, input.version, input.thresholds));
  for (const gold of input.text) row("T1").observations.push(textResolver(gold, input.rules, input.version, input.thresholds));
  let stopped = false;
  for (const call of plannedCalls(input)) {
    if (input.fixture && call.method === "T2") continue;
    if (stopped) { row(call.method).status = "incomplete"; continue; }
    try {
      const replay = await load(call.method, call.gold, call.prompt);
      let observation: Observation;
      switch (call.method) {
        case "system": {
          observation = systemObservation(call.gold, replay.raw, input.rules, input.version, input.thresholds, replay.provenance);
          const ablation = systemObservation(call.gold, replay.raw, input.rules, input.version, input.thresholds, replay.provenance, true);
          // The ablation reuses the identical identification; no second call or duplicated charge.
          row("no-abstain").observations.push({ ...ablation, cost_usd: replay.cost_usd, latency_ms: replay.latency_ms, note: "reuses System identification cost" });
          break;
        }
        case "generic-map": observation = genericObservation(call.gold, replay.raw, replay.provenance); break;
        case "rules-in-prompt": observation = rulesObservation(call.gold, replay.raw, input.rules, false, replay.provenance); break;
        case "rules-in-prompt-unsure": observation = rulesObservation(call.gold, replay.raw, input.rules, true, replay.provenance); break;
        case "T2": observation = textPickerObservation(call.gold, replay.raw, input.rules, input.version, input.thresholds, replay.provenance); break;
      }
      row(call.method).observations.push({ ...observation, cost_usd: replay.cost_usd, latency_ms: replay.latency_ms });
    } catch (error) {
      if (options.stopOnError !== true) throw error; // offline miss/schema failure is an error, never a skipped zero
      row(call.method).status = "incomplete";
      row(call.method).note = `Stopped: ${error instanceof Error ? error.message : "unavailable"}`;
      if (call.method === "system") row("no-abstain").status = "incomplete";
      stopped = true;
    }
  }
  if (stopped) for (const method of PAID_METHODS) if (row(method).observations.length < row(method).expected_n && row(method).status === "complete") row(method).status = "incomplete";
  if (row("system").status === "incomplete") row("no-abstain").status = "incomplete";
  for (const r of rows.values()) {
    if (r.expected_n === 0 && r.status === "complete") { r.status = "not run"; r.note = "No rows in this track/split."; }
    if (input.fixture && r.observations.length > 0) r.note = [r.note, "Authored fixture evidence; not measured model performance."].filter(Boolean).join(" ");
  }
  return [...rows.values()];
}

import { fairness, metrics } from "../../src/evalkit/metrics.ts";
import type { Observation } from "../../src/evalkit/types.ts";

export const METHODS = ["system", "no-abstain", "generic-map", "clip", "rules-in-prompt", "rules-in-prompt-unsure", "typed-oracle", "T1", "T2", "T3"] as const;
export type MethodId = typeof METHODS[number];
export interface MethodRow {
  method: MethodId;
  track: "photo" | "text";
  status: "complete" | "incomplete" | "not run" | "not evaluated / not included";
  observations: Observation[];
  note: string;
  expected_n: number;
}
export interface ReportContext { run_id: string; mode: "fixture" | "live"; split: string; real_photo_count: number; digests?: Record<string, string> }
const percent = (n: number | null): string => n === null ? "N/A" : `${(100 * n).toFixed(1)}%`;
const interval = (v: ReturnType<typeof metrics>["wrong_wilson"]): string => v === null ? "N/A" : `[${percent(v.low)}, ${percent(v.high)}]`;
const cell = (text: string): string => text.replace(/\|/g, "\\|").replace(/[\r\n]/g, " ");

/** Pure report builder. Fixture evidence cannot be upgraded by changing a heading. */
export function buildReport(rows: readonly MethodRow[], context: ReportContext = { run_id: "fixture", mode: "fixture", split: "dev", real_photo_count: 0 }) {
  if (new Set(rows.map((r) => r.method)).size !== rows.length) throw new Error("duplicate method");
  if (context.mode === "live" && rows.some((r) => r.observations.some((o) => o.provenance.startsWith("mock") || (r.track === "photo" && o.gold.licence === "fixture")))) {
    throw new Error("mock provenance refused in live report");
  }
  const completed = rows.map((row) => ({ ...row, metrics: row.observations.length === 0 ? null : metrics(row.observations) }));
  const system = rows.find((r) => r.method === "system");
  const comparisons = ["rules-in-prompt", "rules-in-prompt-unsure"].flatMap((method) => {
    const other = rows.find((r) => r.method === method);
    return system !== undefined && other !== undefined && system.observations.length > 0 && other.observations.length > 0
      ? [{ method, ...fairness(system.observations, other.observations) }] : [];
  });
  const banner = context.real_photo_count === 0 ? "**Not yet measured on real photos.** Authored fixture responses prove harness wiring only." :
    "**Comparison claim is unmeasured until the locked heldout evaluation is reviewed.**";
  const lines = ["# Evaluation results", "", banner, "", `Run: ${context.run_id}; mode: ${context.mode}; split: ${context.split}.`, "",
    "| Method | Track | Status | N / planned | Coverage | Wrong / answered (95% Wilson) | Contaminating | Cost / 100 | Note |",
    "|---|---|---|---|---|---|---|---|---|"];
  for (const row of completed) {
    const m = row.metrics;
    lines.push(`| ${row.method} | ${row.track} | ${row.status} | ${m?.n ?? "N/A"} / ${row.expected_n} | ${m === null ? "N/A" : percent(m.coverage.value)} | ${m === null ? "N/A" : `${m.wrong.numerator}/${m.wrong.denominator} ${interval(m.wrong_wilson)}`} | ${m?.cost.contaminating ?? "N/A"} | ${m?.cost.cost_per_100 === null || m === null ? "N/A" : `$${m.cost.cost_per_100.toFixed(6)}`} | ${cell(row.note)} |`);
  }
  lines.push("", "Denominators, attribute precision/recall/null rates, named errors, latency, risk–coverage and fairness comparisons are in results.jsonl.",
    "Unresolved clarify is never an answer. N/A means no denominator, unavailable usage, or a method not run. Fixture latency/cost are unavailable; no fabricated zeros.", "");
  for (const comparison of comparisons) {
    const subset = comparison.system_answered_subset;
    const equal = comparison.equal_coverage;
    const coverageNote = equal.status === "matched"
      ? `equal-coverage target ${percent(equal.target)} (actual ${percent(equal.actual_system.value)} / ${percent(equal.actual_comparator.value)}).`
      : `equal-coverage comparison unavailable (${equal.reason}); independent tie-preserving floors at target ${percent(equal.target)} attained ${percent(equal.actual_system.value)} / ${percent(equal.actual_comparator.value)}.`;
    lines.push(`${comparison.method}: exact System-answered subset ${subset.metrics.n}/${subset.expected}; ` +
      `wrong ${subset.metrics.wrong.numerator}/${subset.metrics.wrong.denominator}; common answered ${comparison.common_answered.system.n}; ` +
      coverageNote);
  }
  const claim = context.mode === "live" && context.split === "heldout" && rows.every((r) => r.status !== "incomplete") &&
    comparisons.find((c) => c.method === "rules-in-prompt")?.claim_supported === true;
  lines.push("", `Lower same-subset error with no higher contaminating count: ${claim ? "supported by this run; requires review" : "not established"}.`, "");
  const records = [{ type: "run", ...context, claim_established: claim },
    ...completed.map((row) => ({ type: "method", ...row })), ...comparisons.map((comparison) => ({ type: "comparison", ...comparison }))];
  return { md: lines.join("\n"), jsonl: records.map((r) => JSON.stringify(r)).join("\n") + "\n" };
}
/** M5 can wire this generated content into docs/LIMITATIONS.md without hand-copied metrics. */
export function buildLimitations(rows: readonly MethodRow[], context: ReportContext): string {
  return ["# Evaluation limitations", "", context.real_photo_count === 0 ? "Real-photo performance is not yet measured." : "Performance applies only to this manifest, split and configuration.",
    "Fixture City is synthetic and is not real disposal guidance. Authored mock responses do not measure a model.",
    "Thresholds require dev-only tuning; heldout is single-use. Confidence is not a calibrated probability.",
    "CLIP: not run. Jev: not evaluated / not included.", ...rows.filter((r) => r.status !== "complete").map((r) => `- ${r.method}: ${r.status}; ${r.note}`), ""].join("\n");
}

// PLAN.md 4.5 static invariant + M1 acceptance (c) and (f), using the TypeScript compiler API.
// Scans src/** and supabase/functions/** (tests, scripts and fixtures excluded) and fails on: any ResolvedBin
// assertion / brand creation outside src/core/resolve.ts (or outside selectBin() inside it), any export of
// selectBin, any bin / bin_id property in the vision schema or provider files, any src import of scripts/**, and
// any bin-id string literal in src/core (no default bin). In-memory cases prove each rule passes and fails.
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { RESOLVER_FILE, checkSource, inspectResolver, listSourceFiles } from "./binInvariants.ts";
import type { ViolationRule } from "./binInvariants.ts";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

function readRepoFile(relative: string): string {
  return readFileSync(path.join(ROOT, relative), "utf8");
}

/** Bin ids declared by every rules file in rules/ (the only place bins may be named). */
function ruleBinIds(): string[] {
  const ids = new Set<string>();
  for (const name of readdirSync(path.join(ROOT, "rules"))) {
    if (!name.endsWith(".json") || name === "rules.schema.json") continue;
    const parsed = JSON.parse(readRepoFile(`rules/${name}`)) as { bins?: Array<{ id?: unknown }> };
    for (const bin of parsed.bins ?? []) if (typeof bin.id === "string") ids.add(bin.id);
  }
  return [...ids];
}

const BIN_IDS = ruleBinIds();

function rulesHit(file: string, text: string): ViolationRule[] {
  return checkSource(file, text, { binIds: BIN_IDS }).map((v) => v.rule);
}

describe("static invariant: the real source tree", () => {
  it("knows the fixture bin ids", () => {
    expect(BIN_IDS.length).toBeGreaterThanOrEqual(5);
  });

  it("scans the resolver and the core", () => {
    const files = listSourceFiles(ROOT);
    expect(files).toContain(RESOLVER_FILE);
    expect(files).toContain("src/core/feedbackOutcome.ts");
    expect(files.some((f) => f.includes(".test."))).toBe(false);
  });

  it("has no violations in src/** and supabase/functions/**", () => {
    const violations = listSourceFiles(ROOT).flatMap((file) => checkSource(file, readRepoFile(file), { binIds: BIN_IDS }));
    expect(violations).toEqual([]);
  });

  it("resolve.ts declares the ResolvedBin brand, a non-exported selectBin and exactly one brand assertion", () => {
    expect(inspectResolver(readRepoFile(RESOLVER_FILE))).toEqual({
      declaresBrand: true,
      declaresSelectBin: true,
      brandAssertions: 1,
    });
  });
});

describe("static invariant: passing in-memory cases", () => {
  it.each<[string, string, string]>([
    [
      "resolver with a private selectBin",
      RESOLVER_FILE,
      `export type ResolvedBin = string & { readonly __resolved: unique symbol };
function selectBin(bins: readonly string[], id: string): ResolvedBin {
  if (!bins.includes(id)) throw new Error("undeclared");
  return id as ResolvedBin;
}
export function resolve(bins: readonly string[], id: string) {
  return { type: "answer", bin: selectBin(bins, id) };
}`,
    ],
    [
      "render reads an existing result's bin",
      "src/ui/ResultCard.tsx",
      `import type { AnswerResult } from "../core/resolve.ts";
export function ResultCard(props: { result: AnswerResult }) {
  const bin: string = props.result.bin;
  return <p data-bin={bin}>{props.result.bin_label}</p>;
}`,
    ],
    [
      "serializer copies the bin and may name the type",
      "src/core/feedbackOutcome.ts",
      `import type { ResolvedBin } from "./resolve.ts";
export function serialize(result: { bin: ResolvedBin }): { bin: string } {
  return { bin: result.bin };
}`,
    ],
    [
      "vision schema may list the forbidden keys as strings",
      "supabase/functions/identify/visionSchema.ts",
      `const FORBIDDEN_KEYS = new Set(["bin", "bin_id"]);
export interface VisionCandidate { item_id: string; confidence: number }
export function hasForbiddenKey(value: Record<string, unknown>): boolean {
  return Object.keys(value).some((key) => FORBIDDEN_KEYS.has(key)) || value["bin"] !== undefined;
}`,
    ],
    [
      "core copy text that merely contains a bin word",
      "src/core/reasons.ts",
      `export const COPY = { a: "Put it in the right bin.", b: "Not in the garbage truck." };`,
    ],
    [
      "UI code outside src/core may hold a label literal",
      "src/ui/Legend.tsx",
      `export const LEGEND_KEY = "garbage";`,
    ],
    [
      "function files may import each other",
      "supabase/functions/identify/handler.ts",
      `import { validate } from "./visionSchema.ts";
export const handler = validate;`,
    ],
  ])("%s", (_name, file, text) => {
    expect(checkSource(file, text, { binIds: BIN_IDS })).toEqual([]);
  });
});

describe("static invariant: failing in-memory cases", () => {
  it.each<[string, string, string, ViolationRule]>([
    [
      "alternate brand constructor",
      "src/core/brand.ts",
      `import type { ResolvedBin } from "./resolve.ts";
export function makeBin(id: string): ResolvedBin { return id as ResolvedBin; }`,
      "brand_outside_resolver",
    ],
    [
      "double assertion through unknown",
      "src/ui/App.tsx",
      `import type { ResolvedBin } from "../core/resolve.ts";
export const b = "x" as unknown as ResolvedBin;`,
      "brand_outside_resolver",
    ],
    [
      "angle-bracket assertion",
      "src/vision/normalize.ts",
      `import type { ResolvedBin } from "../core/resolve.ts";
export const b = <ResolvedBin>"x";`,
      "brand_outside_resolver",
    ],
    [
      "generic brand helper",
      "src/lib/util.ts",
      `import type { ResolvedBin } from "../core/resolve.ts";
function brand<T>(value: string): T { return value as unknown as T; }
export const b = brand<ResolvedBin>("x");`,
      "brand_outside_resolver",
    ],
    [
      "type guard that fakes the brand",
      "src/lib/guard.ts",
      `import type { ResolvedBin } from "../core/resolve.ts";
export function isBin(value: string): value is ResolvedBin { return value.length > 0; }`,
      "brand_outside_resolver",
    ],
    [
      "a second ResolvedBin declaration",
      "src/core/other.ts",
      `export type ResolvedBin = string & { readonly __resolved: unique symbol };`,
      "brand_outside_resolver",
    ],
    [
      "an object literal carrying the brand property",
      "src/core/fake.ts",
      `export const fake = { __resolved: true };`,
      "brand_outside_resolver",
    ],
    [
      "brand assertion in resolve.ts outside selectBin",
      RESOLVER_FILE,
      `export type ResolvedBin = string & { readonly __resolved: unique symbol };
export function resolve(id: string) { return { bin: id as ResolvedBin }; }`,
      "brand_cast_outside_selectBin",
    ],
    [
      "export function selectBin",
      RESOLVER_FILE,
      `export type ResolvedBin = string & { readonly __resolved: unique symbol };
export function selectBin(id: string): ResolvedBin { return id as ResolvedBin; }`,
      "selectBin_exported",
    ],
    ["export { selectBin }", RESOLVER_FILE, `function selectBin() { return 1; }\nexport { selectBin };`, "selectBin_exported"],
    [
      "export { selectBin as pick }",
      RESOLVER_FILE,
      `function selectBin() { return 1; }\nexport { selectBin as pick };`,
      "selectBin_exported",
    ],
    ["export default selectBin", RESOLVER_FILE, `function selectBin() { return 1; }\nexport default selectBin;`, "selectBin_exported"],
    ["export const selectBin", RESOLVER_FILE, `export const selectBin = (id: string) => id;`, "selectBin_exported"],
    ["re-export from another file", "src/core/index.ts", `export { selectBin } from "./resolve.ts";`, "selectBin_exported"],
    [
      "provider returning a bin",
      "supabase/functions/identify/providers/mock.ts",
      `export function identify() { return { item_count: 1, candidates: [], bin: "recycling" }; }`,
      "bin_field_in_vision_contract",
    ],
    [
      "vision schema type with bin_id",
      "supabase/functions/identify/visionSchema.ts",
      `export interface VisionOutput { item_count: number; bin_id: string }`,
      "bin_field_in_vision_contract",
    ],
    [
      "provider type with a quoted bin property",
      "supabase/functions/identify/providers/types.ts",
      `export type ProviderResult = { "bin": string };`,
      "bin_field_in_vision_contract",
    ],
    [
      "provider assigning a bin by element access",
      "supabase/functions/identify/providers/anthropic.ts",
      `export function shape(out: Record<string, unknown>) { out["bin"] = "x"; return out; }`,
      "bin_field_in_vision_contract",
    ],
    [
      "src import of scripts",
      "src/core/search.ts",
      `import { genericMap } from "../../scripts/baselines/generic-map.ts";\nexport const m = genericMap;`,
      "src_imports_scripts",
    ],
    [
      "src dynamic import of scripts",
      "src/ui/App.tsx",
      `export async function load() { return import("../../scripts/eval.ts"); }`,
      "src_imports_scripts",
    ],
    ["src re-export from scripts", "src/lib/config.ts", `export * from "../../scripts/eval.ts";`, "src_imports_scripts"],
    [
      "default bin literal in src/core",
      "src/core/fallback.ts",
      `export const fallbackBin = "garbage";`,
      "default_bin_literal",
    ],
    [
      "default bin template literal in src/core",
      "src/core/fallback2.ts",
      "export const fallbackBin = `recycling`;",
      "default_bin_literal",
    ],
  ])("%s", (_name, file, text, rule) => {
    expect(rulesHit(file, text)).toContain(rule);
  });

  it("reports file and line", () => {
    const [violation] = checkSource("src/core/brand.ts", `const a = 1;\nexport const b = "x" as ResolvedBin;`, {});
    expect(violation).toMatchObject({ file: "src/core/brand.ts", line: 2, rule: "brand_outside_resolver" });
  });
});

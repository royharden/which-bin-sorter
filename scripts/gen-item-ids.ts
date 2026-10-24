// Regenerates supabase/functions/identify/itemIds.generated.ts from a rules file (PLAN.md 4.2). Run with tsx:
//   tsx scripts/gen-item-ids.ts [rules/<locality>.json] [--check]
// Default file: rules/fixture-city.json. `--check` writes nothing and exits 1 when the committed module differs.
// Exit code 0 = written / up to date, 1 = differs (--check) or the rules file is invalid, 2 = bad arguments or I/O.
// Never run in Dirty Mode (DEFERRED-VALIDATION #22); the committed module was hand-written byte-identical to
// `renderItemIdsModule` output, which tests/itemIds.test.ts asserts.
import { readFileSync, writeFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { pathToFileURL } from "node:url";
import { validateRules } from "../src/core/validateRules.ts";

export const OUTPUT_PATH = "supabase/functions/identify/itemIds.generated.ts";

const HEADER = [
  "// Closed item list (PLAN.md 4.2): the sorted entry ids of rules/fixture-city.json.",
  "// Output of `npx tsx scripts/gen-item-ids.ts` (first written by hand, byte-identical, because generators cannot run",
  "// in Dirty Mode). tests/itemIds.test.ts checks parity with the rules file and with the generator. Do not edit by hand.",
];

/** Sorted (UTF-16 code unit order), de-duplicated entry ids. */
export function sortedItemIds(ids: readonly string[]): string[] {
  return [...new Set(ids)].sort();
}

/** The exact text of itemIds.generated.ts for these ids (LF line endings, trailing newline). */
export function renderItemIdsModule(ids: readonly string[]): string {
  const lines = [
    ...HEADER,
    "",
    "export const ITEM_IDS: readonly string[] = Object.freeze([",
    ...sortedItemIds(ids).map((id) => `  ${JSON.stringify(id)},`),
    "]);",
    "",
  ];
  return lines.join("\n");
}

export interface GenOptions {
  rulesFile: string;
  check: boolean;
}

export function parseArgs(argv: readonly string[]): { ok: true; options: GenOptions } | { ok: false; error: string } {
  let rulesFile = "rules/fixture-city.json";
  let check = false;
  let sawFile = false;
  for (const arg of argv) {
    if (arg === "--check") check = true;
    else if (arg.startsWith("--")) return { ok: false, error: `unknown option ${arg}` };
    else if (sawFile) return { ok: false, error: "only one rules file may be given" };
    else {
      rulesFile = arg;
      sawFile = true;
    }
  }
  return { ok: true, options: { rulesFile, check } };
}

export function main(argv: readonly string[], today: string = new Date().toISOString().slice(0, 10)): number {
  const parsed = parseArgs(argv);
  if (!parsed.ok) {
    console.error(`${parsed.error}\nusage: gen-item-ids [rules file] [--check]`);
    return 2;
  }
  const { rulesFile, check } = parsed.options;
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(resolvePath(rulesFile), "utf8"));
  } catch (error) {
    console.error(`${rulesFile}: cannot read or parse JSON (${(error as Error).message})`);
    return 2;
  }
  const isFixture = typeof raw === "object" && raw !== null && (raw as { fixture?: unknown }).fixture === true;
  const report = validateRules(raw, { today, mode: isFixture ? "fixture" : "release", stale: "warn" });
  if (!report.ok || report.rules === null) {
    for (const issue of report.errors) console.error(`${rulesFile}: ERROR ${issue.code} at ${issue.path}`);
    return 1;
  }
  const text = renderItemIdsModule(report.rules.entries.map((entry) => entry.id));
  const outPath = resolvePath(OUTPUT_PATH);
  if (check) {
    let current = "";
    try {
      current = readFileSync(outPath, "utf8").replace(/\r\n/g, "\n");
    } catch {
      current = "";
    }
    if (current !== text) {
      console.error(`${OUTPUT_PATH} is out of date; run: npx tsx scripts/gen-item-ids.ts ${rulesFile}`);
      return 1;
    }
    console.log(`${OUTPUT_PATH} is up to date (${report.rules.entries.length} ids)`);
    return 0;
  }
  writeFileSync(outPath, text, "utf8");
  console.log(`wrote ${OUTPUT_PATH} (${report.rules.entries.length} ids)`);
  return 0;
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && import.meta.url === pathToFileURL(resolvePath(invokedPath)).href) {
  process.exitCode = main(process.argv.slice(2));
}

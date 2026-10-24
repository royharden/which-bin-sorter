// Rules validator CLI (PLAN.md 4.1). Run with tsx:
//   tsx scripts/validate-rules.ts [rules/<locality>.json ...] --today YYYY-MM-DD --mode fixture|release --stale warn|fail
// Defaults: file rules/fixture-city.json, today = current UTC date, mode fixture, stale warn.
// Exit code 0 = no errors (warnings allowed), 1 = validation errors, 2 = bad arguments or unreadable file.
import { readFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { pathToFileURL } from "node:url";
import { validateRules } from "../src/core/validateRules.ts";
import type { StalePolicy, ValidationMode } from "../src/core/validateRules.ts";
import { computeRulesVersion } from "../src/core/rulesVersion.ts";

export interface CliOptions {
  files: string[];
  today: string;
  mode: ValidationMode;
  stale: StalePolicy;
}

export type ParseResult = { ok: true; options: CliOptions } | { ok: false; error: string };

const USAGE =
  "usage: validate-rules [file ...] --today YYYY-MM-DD --mode fixture|release --stale warn|fail";

export function parseArgs(argv: readonly string[], now: Date = new Date()): ParseResult {
  const files: string[] = [];
  let today = now.toISOString().slice(0, 10);
  let mode: ValidationMode = "fixture";
  let stale: StalePolicy = "warn";
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === undefined) continue;
    if (arg === "--today" || arg === "--mode" || arg === "--stale") {
      const value = argv[i + 1];
      if (value === undefined) return { ok: false, error: `${arg} needs a value\n${USAGE}` };
      i++;
      if (arg === "--today") {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return { ok: false, error: `--today must be YYYY-MM-DD\n${USAGE}` };
        today = value;
      } else if (arg === "--mode") {
        if (value !== "fixture" && value !== "release") return { ok: false, error: `--mode must be fixture|release\n${USAGE}` };
        mode = value;
      } else {
        if (value !== "warn" && value !== "fail") return { ok: false, error: `--stale must be warn|fail\n${USAGE}` };
        stale = value;
      }
    } else if (arg === "--help" || arg === "-h") {
      return { ok: false, error: USAGE };
    } else if (arg.startsWith("--")) {
      return { ok: false, error: `unknown option ${arg}\n${USAGE}` };
    } else {
      files.push(arg);
    }
  }
  if (files.length === 0) files.push("rules/fixture-city.json");
  return { ok: true, options: { files, today, mode, stale } };
}

export async function main(argv: readonly string[]): Promise<number> {
  const parsed = parseArgs(argv);
  if (!parsed.ok) {
    console.error(parsed.error);
    return 2;
  }
  const { files, today, mode, stale } = parsed.options;
  let exitCode = 0;
  for (const file of files) {
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(resolvePath(file), "utf8"));
    } catch (error) {
      console.error(`${file}: cannot read or parse JSON (${(error as Error).message})`);
      exitCode = 2;
      continue;
    }
    const report = validateRules(raw, { today, mode, stale });
    for (const issue of report.warnings) console.warn(`${file}: WARN  ${issue.code} at ${issue.path}: ${issue.message}`);
    for (const issue of report.errors) console.error(`${file}: ERROR ${issue.code} at ${issue.path}: ${issue.message}`);
    const entryCount = Array.isArray((raw as { entries?: unknown }).entries)
      ? (raw as { entries: unknown[] }).entries.length
      : 0;
    if (report.ok) {
      const version = await computeRulesVersion(raw);
      console.log(
        `${file}: OK (${entryCount} entries, mode ${mode}, stale ${stale}, today ${today}, ` +
          `${report.warnings.length} warning(s)) rules_version ${version}`,
      );
    } else {
      console.error(`${file}: FAILED with ${report.errors.length} error(s)`);
      if (exitCode === 0) exitCode = 1;
    }
  }
  return exitCode;
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && import.meta.url === pathToFileURL(resolvePath(invokedPath)).href) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (error: unknown) => {
      console.error(error);
      process.exitCode = 2;
    },
  );
}

// Loads and validates a rules file for the app, and computes its runtime rules_version (PLAN.md 4.1).
import fixtureCityJson from "../../rules/fixture-city.json";
import type { RulesFile } from "./rules.ts";
import { validateRules } from "./validateRules.ts";
import type { Issue } from "./validateRules.ts";
import { computeRulesVersion } from "./rulesVersion.ts";

export interface LoadedRules {
  rules: RulesFile;
  /** sha256 hex of the canonical JSON of the file. */
  version: string;
  /** Non-fatal issues (e.g. stale verified_on under the warn policy). */
  warnings: Issue[];
}

export class RulesLoadError extends Error {
  readonly issues: Issue[];
  constructor(issues: Issue[]) {
    super(`rules file failed validation: ${issues.map((i) => `${i.code} at ${i.path}`).join("; ")}`);
    this.name = "RulesLoadError";
    this.issues = issues;
  }
}

export function utcToday(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/**
 * Validates `raw` (fixture files in fixture mode, anything else in release mode; staleness only warns at runtime)
 * and computes its rules_version. Throws RulesLoadError on any validation error.
 */
export async function loadRules(raw: unknown, today: string = utcToday()): Promise<LoadedRules> {
  const isFixture = typeof raw === "object" && raw !== null && (raw as { fixture?: unknown }).fixture === true;
  const report = validateRules(raw, { today, mode: isFixture ? "fixture" : "release", stale: "warn" });
  if (!report.ok || report.rules === null) throw new RulesLoadError(report.errors);
  const version = await computeRulesVersion(raw);
  return { rules: report.rules, version, warnings: report.warnings };
}

/** The bundled synthetic Fixture City table (not real disposal guidance). */
export function loadFixtureCity(today: string = utcToday()): Promise<LoadedRules> {
  return loadRules(fixtureCityJson as unknown, today);
}

// Test helpers over the bundled Fixture City rules.
import fixtureJson from "../../rules/fixture-city.json";
import { validateRules } from "../../src/core/validateRules.ts";
import type { RuleEntry, RulesFile } from "../../src/core/rules.ts";
import type { Thresholds } from "../../src/core/thresholds.ts";

/** Fixture generation date; also the fixed `--today` used by tests. */
export const FIXTURE_TODAY = "2026-10-24";

export const TEST_RULES_VERSION = "test-rules-version";

export const TEST_THRESHOLDS: Thresholds = { t_low: 0.8, margin: 0.1, provenance: "test" };

/** A fresh deep copy of the fixture JSON, typed as a rules file so tests can mutate it into bad variants. */
export function rawFixture(): RulesFile {
  return structuredClone(fixtureJson) as unknown as RulesFile;
}

/** The validated fixture (throws if the fixture itself is invalid). */
export function fixtureRules(): RulesFile {
  const report = validateRules(rawFixture(), { today: FIXTURE_TODAY, mode: "fixture", stale: "fail" });
  if (report.rules === null) {
    throw new Error(`fixture-city.json is invalid: ${report.errors.map((e) => `${e.code}@${e.path}`).join(", ")}`);
  }
  return report.rules;
}

export function entryById(rules: RulesFile, id: string): RuleEntry {
  const entry = rules.entries.find((e) => e.id === id);
  if (entry === undefined) throw new Error(`no fixture entry "${id}"`);
  return entry;
}

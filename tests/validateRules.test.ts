// M1 acceptance (b): one bad fixture per validator failure class (PLAN.md 4.1), a planted bad entry,
// release-mode rejection of fixture markers, and a fixed --today for warn/fail staleness.
import { describe, expect, it } from "vitest";
import { isStale, parseIsoDate, validateRules } from "../src/core/validateRules.ts";
import type { IssueCode, ValidateOptions, ValidationReport } from "../src/core/validateRules.ts";
import type { RuleEntry, RuleSource, RulesFile } from "../src/core/rules.ts";
import { FIXTURE_TODAY, entryById, rawFixture } from "./helpers/fixtureRules.ts";

const FIXTURE_OPTS: ValidateOptions = { today: FIXTURE_TODAY, mode: "fixture", stale: "fail" };

function codes(report: ValidationReport): IssueCode[] {
  return report.errors.map((issue) => issue.code);
}

function mutated(change: (file: RulesFile) => void, options: ValidateOptions = FIXTURE_OPTS): ValidationReport {
  const file = rawFixture();
  change(file);
  return validateRules(file, options);
}

function expectFailure(report: ValidationReport, code: IssueCode): void {
  expect(report.ok).toBe(false);
  expect(report.rules).toBeNull();
  expect(codes(report)).toContain(code);
}

describe("validateRules: the unmodified fixture", () => {
  it("passes with no errors or warnings", () => {
    const report = validateRules(rawFixture(), FIXTURE_OPTS);
    expect(report.errors).toEqual([]);
    expect(report.warnings).toEqual([]);
    expect(report.rules).not.toBeNull();
  });
});

describe("validateRules: one bad fixture per failure class", () => {
  it("missing source field", () => {
    const report = mutated((f) => {
      delete (entryById(f, "pizza_box").source as Partial<RuleSource>).verified_by;
    });
    expectFailure(report, "missing_source_field");
    expect(report.errors.find((e) => e.code === "missing_source_field")?.path).toBe("entries[0].source.verified_by");
  });

  it("missing source object", () => {
    const report = mutated((f) => {
      delete (entryById(f, "cardboard_box") as Partial<RuleEntry>).source;
    });
    expectFailure(report, "missing_source_field");
  });

  it("empty source field", () => {
    expectFailure(
      mutated((f) => {
        entryById(f, "cardboard_box").source.url = "";
      }),
      "missing_source_field",
    );
  });

  it("unknown bin on an entry", () => {
    expectFailure(
      mutated((f) => {
        entryById(f, "cardboard_box").bin = "blue_bin";
      }),
      "unknown_bin",
    );
  });

  it("unknown bin on a condition", () => {
    expectFailure(
      mutated((f) => {
        const first = entryById(f, "pizza_box").conditions[0];
        if (first) first.bin = "compost_heap";
      }),
      "unknown_bin",
    );
  });

  it("duplicate alias across entries (after normalization)", () => {
    expectFailure(
      mutated((f) => {
        entryById(f, "cardboard_box").aliases.push("  PIZZA-carton! ");
      }),
      "duplicate_alias",
    );
  });

  it("alias equal to another entry's name", () => {
    expectFailure(
      mutated((f) => {
        entryById(f, "cardboard_box").aliases.push("Glass Jar");
      }),
      "duplicate_alias",
    );
  });

  it("duplicate id", () => {
    expectFailure(
      mutated((f) => {
        entryById(f, "cardboard_box").id = "pizza_box";
      }),
      "duplicate_id",
    );
  });

  it("unknown attribute in a condition", () => {
    expectFailure(
      mutated((f) => {
        const first = entryById(f, "pizza_box").conditions[0];
        if (first) (first.when as Record<string, boolean>)["is_greasy"] = true;
      }),
      "unknown_attribute",
    );
  });

  it("unknown attribute in a question", () => {
    expectFailure(
      mutated((f) => {
        (entryById(f, "pizza_box").questions as Record<string, string>)["colour"] = "What colour is it?";
      }),
      "unknown_attribute",
    );
  });

  it("condition with neither bin nor instruction", () => {
    expectFailure(
      mutated((f) => {
        const first = entryById(f, "pizza_box").conditions[0];
        if (first) delete first.bin;
      }),
      "condition_without_outcome",
    );
  });

  it("missing question for a conditioned attribute", () => {
    expectFailure(
      mutated((f) => {
        delete entryById(f, "pizza_box").questions.food_soiled;
      }),
      "missing_question",
    );
  });

  it("contradiction: same clauses, equal priority, different bins", () => {
    expectFailure(
      mutated((f) => {
        entryById(f, "pizza_box").conditions.push({ when: { food_soiled: true }, bin: "garbage", priority: 1 });
      }),
      "contradictory_conditions",
    );
  });

  it("contradiction: overlapping clauses on different attributes, equal priority", () => {
    expectFailure(
      mutated((f) => {
        // compatible with {broken:false, has_lid:true} -> recycling at priority 1
        entryById(f, "glass_jar").conditions.push({ when: { has_lid: true }, bin: "garbage", priority: 1 });
      }),
      "contradictory_conditions",
    );
  });

  it("contradiction: bin vs instruction at equal priority", () => {
    expectFailure(
      mutated((f) => {
        entryById(f, "gas_cylinder").conditions.push({ when: { liquid_inside: true }, bin: "drop_off", priority: 1 });
      }),
      "contradictory_conditions",
    );
  });

  it("no contradiction when priorities differ or outcomes agree", () => {
    const differentPriority = mutated((f) => {
      entryById(f, "pizza_box").conditions.push({ when: { food_soiled: true }, bin: "garbage", priority: 2 });
    });
    expect(codes(differentPriority)).not.toContain("contradictory_conditions");
    const sameOutcome = mutated((f) => {
      entryById(f, "pizza_box").conditions.push({ when: { food_soiled: true }, bin: "food_and_garden", priority: 1 });
    });
    expect(codes(sameOutcome)).not.toContain("contradictory_conditions");
  });

  it("bin present on an entry with conditions (no default bin)", () => {
    expectFailure(
      mutated((f) => {
        entryById(f, "pizza_box").bin = "recycling";
      }),
      "bin_presence",
    );
  });

  it("bin missing on an entry without conditions", () => {
    expectFailure(
      mutated((f) => {
        entryById(f, "cardboard_box").bin = null;
      }),
      "bin_presence",
    );
  });

  it("ask_council entry with a bin", () => {
    expectFailure(
      mutated((f) => {
        entryById(f, "paint_tin").bin = "hazardous_drop_off";
      }),
      "ask_council_shape",
    );
  });

  it("unknown field on an entry and at top level", () => {
    expectFailure(
      mutated((f) => {
        (entryById(f, "cardboard_box") as unknown as Record<string, unknown>)["default_bin"] = "recycling";
      }),
      "unknown_field",
    );
    expectFailure(
      mutated((f) => {
        (f as unknown as Record<string, unknown>)["notes"] = "x";
      }),
      "unknown_field",
    );
  });

  it("reserved entry id none", () => {
    expectFailure(
      mutated((f) => {
        entryById(f, "cardboard_box").id = "none";
      }),
      "schema",
    );
  });

  it("bad date and bad --today", () => {
    expectFailure(
      mutated((f) => {
        entryById(f, "cardboard_box").source.verified_on = "2026-02-30";
      }),
      "bad_date",
    );
    expectFailure(validateRules(rawFixture(), { ...FIXTURE_OPTS, today: "24/10/2026" }), "bad_today");
  });

  it("non-object input", () => {
    expectFailure(validateRules([], FIXTURE_OPTS), "schema");
    expectFailure(validateRules(null, FIXTURE_OPTS), "schema");
  });
});

describe("validateRules: planted bad entry", () => {
  it("fails, reporting each defect of the planted entry", () => {
    const report = mutated((f) => {
      f.entries.push({
        id: "planted_bad",
        name: "Planted bad entry",
        aliases: ["pizza box"], // collides with pizza_box's name
        material: "mystery",
        bin: "compost_heap", // undeclared bin
        conditions: [],
        questions: {},
        prep_steps: [],
        ask_council: false,
        source: {
          kind: "fixture",
          url: "", // missing
          section: "Planted",
          retrieved_on: FIXTURE_TODAY,
          verified_by: "fixture-generator",
          verified_on: FIXTURE_TODAY,
        },
      });
    });
    expect(report.ok).toBe(false);
    const planted = report.errors.filter((e) => e.path.startsWith(`entries[34]`));
    expect(planted.map((e) => e.code).sort()).toEqual(["duplicate_alias", "missing_source_field", "unknown_bin"]);
  });
});

describe("validateRules: staleness with a fixed --today", () => {
  // verified_on 2026-10-24: 2027-04-22 is exactly 180 days later (not stale), 2027-04-23 is 181 (stale).
  it("is not stale at exactly 180 days", () => {
    const report = validateRules(rawFixture(), { today: "2027-04-22", mode: "fixture", stale: "fail" });
    expect(report.ok).toBe(true);
    expect(report.warnings).toEqual([]);
  });

  it("warns at 181 days under --stale warn", () => {
    const report = validateRules(rawFixture(), { today: "2027-04-23", mode: "fixture", stale: "warn" });
    expect(report.ok).toBe(true);
    expect(report.errors).toEqual([]);
    expect(report.warnings.length).toBe(rawFixture().entries.length);
    expect(report.warnings.every((w) => w.code === "stale_source")).toBe(true);
  });

  it("fails at 181 days under --stale fail", () => {
    const report = validateRules(rawFixture(), { today: "2027-04-23", mode: "fixture", stale: "fail" });
    expectFailure(report, "stale_source");
    expect(report.warnings).toEqual([]);
  });

  it("flags only the stale entry", () => {
    const report = mutated(
      (f) => {
        entryById(f, "cardboard_box").source.verified_on = "2026-01-01";
      },
      { today: FIXTURE_TODAY, mode: "fixture", stale: "warn" },
    );
    expect(report.warnings.map((w) => w.path)).toEqual(["entries[1].source.verified_on"]);
  });

  it("isStale and parseIsoDate helpers", () => {
    expect(isStale("2026-10-24", "2027-04-22")).toBe(false);
    expect(isStale("2026-10-24", "2027-04-23")).toBe(true);
    expect(isStale("2026-10-24", "2026-11-24", 30)).toBe(true);
    expect(parseIsoDate("2026-02-29")).toBeNull();
    expect(parseIsoDate("2028-02-29")).not.toBeNull();
    expect(() => isStale("yesterday", "2026-10-24")).toThrow();
  });
});

describe("validateRules: release mode", () => {
  it("rejects every fixture marker", () => {
    const report = validateRules(rawFixture(), { today: FIXTURE_TODAY, mode: "release", stale: "fail" });
    expect(report.ok).toBe(false);
    const found = new Set(codes(report));
    for (const code of [
      "release_fixture_source",
      "release_example_url",
      "release_fixture_flag",
      "release_fixture_verifier",
    ] as const) {
      expect(found.has(code)).toBe(true);
    }
  });

  it("accepts a council-sourced, non-fixture file", () => {
    const report = mutated(
      (f) => {
        f.fixture = false;
        f.locality.council_url = "https://council.example.org/waste";
        for (const entry of f.entries) {
          entry.source = {
            ...entry.source,
            kind: "council",
            url: `https://council.example.org/waste/a-z#${entry.id}`,
            verified_by: "R. Harden",
          };
        }
      },
      { today: FIXTURE_TODAY, mode: "release", stale: "fail" },
    );
    expect(report.errors).toEqual([]);
    expect(report.ok).toBe(true);
  });

  it("rejects a single remaining example.invalid URL", () => {
    const report = mutated(
      (f) => {
        f.fixture = false;
        f.locality.council_url = "https://council.example.org/waste";
        for (const entry of f.entries) {
          entry.source = { ...entry.source, kind: "council", url: `https://council.example.org/#${entry.id}`, verified_by: "R. Harden" };
        }
        entryById(f, "glass_jar").source.url = "https://fixture-city.example.invalid/rules#glass_jar";
      },
      { today: FIXTURE_TODAY, mode: "release", stale: "fail" },
    );
    expect(codes(report)).toEqual(["release_example_url"]);
  });
});

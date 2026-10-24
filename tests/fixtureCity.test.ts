// M1 acceptance (a): Fixture City has 32-36 entries, every trap in PLAN.md 4.1 by id, full fixture sources.
import { describe, expect, it } from "vitest";
import { ATTRIBUTE_ORDER } from "../src/core/rules.ts";
import { validateRules } from "../src/core/validateRules.ts";
import { CLOSED_LIST_80, CLOSED_LIST_80_SIZE } from "./fixtures/closed-list-80.ts";
import { FIXTURE_TODAY, entryById, fixtureRules, rawFixture } from "./helpers/fixtureRules.ts";

const FIXTURE_BINS = ["recycling", "food_and_garden", "garbage", "drop_off", "hazardous_drop_off"];

describe("Fixture City rules file", () => {
  const rules = fixtureRules();

  it("validates in fixture mode with stale=fail at the fixture date", () => {
    const report = validateRules(rawFixture(), { today: FIXTURE_TODAY, mode: "fixture", stale: "fail" });
    expect(report.errors).toEqual([]);
    expect(report.warnings).toEqual([]);
    expect(report.ok).toBe(true);
  });

  it("has 32-36 entries", () => {
    expect(rules.entries.length).toBeGreaterThanOrEqual(32);
    expect(rules.entries.length).toBeLessThanOrEqual(36);
  });

  it("is marked fixture and declares exactly the five fixture bins, each used at least once", () => {
    expect(rules.fixture).toBe(true);
    expect(rules.bins.map((b) => b.id)).toEqual(FIXTURE_BINS);
    const used = new Set<string>();
    for (const entry of rules.entries) {
      if (entry.bin !== null) used.add(entry.bin);
      for (const condition of entry.conditions) if (condition.bin !== undefined) used.add(condition.bin);
    }
    expect([...used].sort()).toEqual([...FIXTURE_BINS].sort());
  });

  it("gives every entry a full fixture source on fixture-city.example.invalid dated 2026-10-24", () => {
    for (const entry of rules.entries) {
      expect(entry.source).toEqual({
        kind: "fixture",
        url: `https://fixture-city.example.invalid/rules#${entry.id}`,
        section: expect.stringMatching(/\S/),
        retrieved_on: FIXTURE_TODAY,
        verified_by: "fixture-generator",
        verified_on: FIXTURE_TODAY,
      });
    }
    expect(rules.locality.council_url.startsWith("https://fixture-city.example.invalid")).toBe(true);
  });

  it("contains every planted trap by id", () => {
    const conditioned = (id: string) => entryById(rules, id).conditions.flatMap((c) => Object.keys(c.when));
    // pizza box (food_soiled)
    expect(conditioned("pizza_box")).toContain("food_soiled");
    // cardboard box
    expect(entryById(rules, "cardboard_box").bin).toBe("recycling");
    // plastic film / bags -> drop-off
    expect(entryById(rules, "plastic_film").bin).toBe("drop_off");
    // black plastic tray
    expect(entryById(rules, "black_plastic_tray").bin).not.toBeNull();
    // lined paper cup vs unlined paper cup / plate: different bins
    expect(entryById(rules, "lined_paper_cup").bin).not.toBe(entryById(rules, "unlined_paper_cup").bin);
    expect(conditioned("paper_plate")).toContain("food_soiled");
    // aerosol (liquid_inside)
    expect(conditioned("aerosol_can")).toContain("liquid_inside");
    // device with embedded battery (contains_battery) and loose battery
    expect(conditioned("small_electrical_device")).toContain("contains_battery");
    expect(entryById(rules, "loose_battery").bin).not.toBeNull();
    // jar (has_lid)
    expect(conditioned("glass_jar")).toContain("has_lid");
    // clear glass vs clear plastic bottle: near-neighbours in different bins (the ambiguous_bins pair)
    const glass = entryById(rules, "clear_glass_bottle");
    const plastic = entryById(rules, "clear_plastic_bottle");
    expect(glass.bin).not.toBeNull();
    expect(plastic.bin).not.toBeNull();
    expect(glass.bin).not.toBe(plastic.bin);
    // broken glass (broken)
    expect(conditioned("drinking_glass")).toContain("broken");
    // compostable-marked plastic (compostable_marking)
    expect(conditioned("compostable_plastic_cup")).toContain("compostable_marking");
    // one ask_council entry
    expect(entryById(rules, "paint_tin").ask_council).toBe(true);
    // an instruction-only condition
    expect(entryById(rules, "gas_cylinder").conditions.some((c) => c.bin === undefined && c.instruction !== undefined)).toBe(
      true,
    );
  });

  it("covers all six condition attributes somewhere in the table", () => {
    const used = new Set(rules.entries.flatMap((e) => e.conditions.flatMap((c) => Object.keys(c.when))));
    for (const attr of ATTRIBUTE_ORDER) expect(used.has(attr)).toBe(true);
  });

  it("has exactly one ask_council entry, with no bin and no conditions", () => {
    const askCouncil = rules.entries.filter((e) => e.ask_council);
    expect(askCouncil.map((e) => e.id)).toEqual(["paint_tin"]);
    expect(askCouncil[0]?.bin).toBeNull();
    expect(askCouncil[0]?.conditions).toEqual([]);
  });
});

describe("closed-list-80 stress fixture", () => {
  it("is 80 deterministic, sorted, unique ids that never collide with fixture ids", () => {
    expect(CLOSED_LIST_80).toHaveLength(CLOSED_LIST_80_SIZE);
    expect(CLOSED_LIST_80[0]).toBe("stress_item_001");
    expect(CLOSED_LIST_80[79]).toBe("stress_item_080");
    expect(new Set(CLOSED_LIST_80).size).toBe(80);
    expect([...CLOSED_LIST_80].sort()).toEqual([...CLOSED_LIST_80]);
    const fixtureIds = new Set(fixtureRules().entries.map((e) => e.id));
    expect(CLOSED_LIST_80.some((id) => fixtureIds.has(id))).toBe(false);
  });
});

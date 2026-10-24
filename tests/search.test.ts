// M1 acceptance (e): exact alias, token candidates, misspelling (edit distance <= 1 on tokens), collision ->
// multiple candidates, and a "cell"-style substring non-match.
import { describe, expect, it } from "vitest";
import { normalizeText, searchItems, tokenize, withinOneEdit } from "../src/core/search.ts";
import { fixtureRules } from "./helpers/fixtureRules.ts";

const rules = fixtureRules();

describe("normalizeText / tokenize", () => {
  it("lowercases, strips punctuation and diacritics, collapses whitespace", () => {
    expect(normalizeText("  Cardboard-Box! ")).toBe("cardboard box");
    expect(normalizeText("Crème  Brûlée pot")).toBe("creme brulee pot");
    expect(tokenize("Plastic-lined paper cup")).toEqual(["plastic", "lined", "paper", "cup"]);
    expect(tokenize("   ")).toEqual([]);
  });
});

describe("withinOneEdit", () => {
  it.each<[string, string, boolean]>([
    ["pizza", "pizza", true],
    ["pizzza", "pizza", true], // insertion
    ["aersol", "aerosol", true], // deletion
    ["bottke", "bottle", true], // substitution
    ["bottel", "bottle", true], // adjacent transposition
    ["cell", "cellophane", false],
    ["cell", "cellphone", false],
    ["botle", "bottles", false],
  ])("%s vs %s -> %s", (a, b, expected) => {
    expect(withinOneEdit(a, b)).toBe(expected);
    expect(withinOneEdit(b, a)).toBe(expected);
  });
});

describe("searchItems", () => {
  it.each<[string, string]>([
    ["cardboard box", "cardboard_box"],
    ["  Cardboard-Box! ", "cardboard_box"],
    ["Glass jar", "glass_jar"], // entry name
    ["Pizza Carton", "pizza_box"],
    ["aerosol", "aerosol_can"], // the demo typed path
    ["coffee cup", "lined_paper_cup"],
  ])("exact alias or name %j -> %s", (query, id) => {
    expect(searchItems(rules, query)).toEqual({ kind: "exact", entry_id: id });
  });

  it("token candidates: extra words still find the entry", () => {
    expect(searchItems(rules, "greasy pizza box")).toEqual({ kind: "candidates", entry_ids: ["pizza_box"] });
  });

  it("misspellings within one edit per token", () => {
    expect(searchItems(rules, "pizzza box")).toEqual({ kind: "candidates", entry_ids: ["pizza_box"] });
    expect(searchItems(rules, "aersol")).toEqual({ kind: "candidates", entry_ids: ["aerosol_can"] });
    expect(searchItems(rules, "cellophan")).toEqual({ kind: "candidates", entry_ids: ["plastic_film"] });
  });

  it("collision: one query, several entries, resolved by the user's selection", () => {
    expect(searchItems(rules, "paper cup")).toEqual({
      kind: "candidates",
      entry_ids: ["lined_paper_cup", "unlined_paper_cup"],
    });
    expect(searchItems(rules, "bottle")).toEqual({
      kind: "candidates",
      entry_ids: ["clear_glass_bottle", "clear_plastic_bottle"],
    });
    expect(searchItems(rules, "bottel")).toEqual({
      kind: "candidates",
      entry_ids: ["clear_glass_bottle", "clear_plastic_bottle"],
    });
    const box = searchItems(rules, "box");
    expect(box.kind).toBe("candidates");
    if (box.kind === "candidates") expect(box.entry_ids).toEqual(["cardboard_box", "egg_carton", "pizza_box"]);
  });

  it('"cell" never matches by substring (cellophane, cellphone)', () => {
    const result = searchItems(rules, "cell");
    expect(result.kind).toBe("candidates");
    if (result.kind === "candidates") {
      // whole-token matches only: "cell phone" and "battery cell"
      expect(result.entry_ids).toEqual(["loose_battery", "mobile_phone"]);
      expect(result.entry_ids).not.toContain("plastic_film");
    }
  });

  it("short tokens get no fuzzy matching, and nonsense finds nothing", () => {
    expect(searchItems(rules, "cel")).toEqual({ kind: "none" });
    expect(searchItems(rules, "xylophone")).toEqual({ kind: "none" });
    expect(searchItems(rules, "the")).toEqual({ kind: "none" });
    expect(searchItems(rules, "   ")).toEqual({ kind: "none" });
  });

  it("respects the candidate limit", () => {
    const result = searchItems(rules, "box", 2);
    expect(result).toEqual({ kind: "candidates", entry_ids: ["cardboard_box", "egg_carton"] });
  });
});

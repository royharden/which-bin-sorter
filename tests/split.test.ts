import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { groupSplit, assertDisjointGroups } from "../src/evalkit/split.ts";
import { parseManifest } from "../scripts/eval/manifest.ts";
import { rawFixture } from "./helpers/fixtureRules.ts";
describe("grouped dev/heldout", () => {
  it("is deterministic under reorder and never splits siblings", () => {
    const rows = Array.from({ length: 90 }, (_, i) => ({ id: i, group: `item_${Math.floor(i / 3)}` }));
    const first = groupSplit(rows, (r) => r.group, "s31-fixed");
    const reordered = groupSplit([...rows].reverse(), (r) => r.group, "s31-fixed");
    expect(first.dev.map((r) => r.id).sort((a, b) => a - b)).toEqual(reordered.dev.map((r) => r.id).sort((a, b) => a - b));
    assertDisjointGroups(first.dev, first.heldout, (r) => r.group);
    expect(first.counts.dev + first.counts.heldout).toBe(90);
    expect(() => assertDisjointGroups([{ group: "hose" }], [{ group: "hose" }], (r) => r.group)).toThrow("leakage");
  });
  it("ships at least 60 text rows with disjoint underlying items and categories", () => {
    const read = (name: string) => parseManifest(readFileSync(new URL(`../eval/text/${name}`, import.meta.url), "utf8"), rawFixture());
    const dev = read("queries.dev.jsonl"), heldout = read("queries.heldout.jsonl");
    expect(dev.length).toBe(36); expect(heldout.length).toBe(24);
    assertDisjointGroups(dev, heldout, (r) => r.item_group);
    expect(dev.every((r) => r.split === "dev" && r.query)).toBe(true);
    expect(heldout.every((r) => r.split === "heldout" && r.query)).toBe(true);
    const bad = { ...dev[0]!, licence: "CC0", file: null, sha256: null };
    expect(() => parseManifest(JSON.stringify(bad), rawFixture())).toThrow("file/hash");
  });
});

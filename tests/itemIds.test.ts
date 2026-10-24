// PLAN.md 4.2: the closed item list equals the sorted fixture-city ids, the committed module is byte-identical to
// what scripts/gen-item-ids.ts would write, and closedListHash = sha256 hex of ids.join("\n") (runtime, not committed).
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ITEM_IDS } from "../supabase/functions/identify/itemIds.generated.ts";
import { closedListHash } from "../supabase/functions/identify/closedList.ts";
import { bytesToHex, sha256Hex as functionSha256Hex } from "../supabase/functions/identify/sha256.ts";
import { sha256Hex as coreSha256Hex } from "../src/core/hash.ts";
import { OUTPUT_PATH, parseArgs, renderItemIdsModule, sortedItemIds } from "../scripts/gen-item-ids.ts";
import { rawFixture } from "./helpers/fixtureRules.ts";

const ROOT = fileURLToPath(new URL("../", import.meta.url));

describe("ITEM_IDS parity with rules/fixture-city.json", () => {
  const fixtureIds = rawFixture().entries.map((entry) => entry.id);

  it("equals the sorted fixture entry ids", () => {
    expect([...ITEM_IDS]).toEqual([...fixtureIds].sort());
  });

  it("is sorted, unique, frozen and never contains the reserved none id", () => {
    expect([...ITEM_IDS]).toEqual([...ITEM_IDS].sort());
    expect(new Set(ITEM_IDS).size).toBe(ITEM_IDS.length);
    expect(Object.isFrozen(ITEM_IDS)).toBe(true);
    expect(ITEM_IDS).not.toContain("none");
  });

  it("the committed module is byte-identical to the generator output (line endings normalized)", () => {
    const committed = readFileSync(path.join(ROOT, OUTPUT_PATH), "utf8").replace(/\r\n/g, "\n");
    expect(committed).toBe(renderItemIdsModule(fixtureIds));
  });

  it("the generator sorts and de-duplicates, and parses its arguments", () => {
    expect(sortedItemIds(["b", "a", "b"])).toEqual(["a", "b"]);
    expect(parseArgs([])).toEqual({ ok: true, options: { rulesFile: "rules/fixture-city.json", check: false } });
    expect(parseArgs(["rules/x.json", "--check"])).toEqual({ ok: true, options: { rulesFile: "rules/x.json", check: true } });
    expect(parseArgs(["--nope"]).ok).toBe(false);
    expect(parseArgs(["a.json", "b.json"]).ok).toBe(false);
  });
});

describe("closedListHash", () => {
  it('is the sha256 hex of ids.join("\\n"), matching the core hash implementation', async () => {
    const hash = await closedListHash(ITEM_IDS);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).toBe(await coreSha256Hex(ITEM_IDS.join("\n")));
  });

  it("is deterministic and changes when the list changes", async () => {
    expect(await closedListHash(ITEM_IDS)).toBe(await closedListHash([...ITEM_IDS]));
    expect(await closedListHash(ITEM_IDS)).not.toBe(await closedListHash(ITEM_IDS.slice(1)));
    expect(await closedListHash(["a", "b"])).not.toBe(await closedListHash(["b", "a"]));
  });

  it("function sha256 helper agrees with the core helper", async () => {
    expect(await functionSha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    expect(await functionSha256Hex(Uint8Array.from([1, 2, 3]))).toBe(await coreSha256Hex(Uint8Array.from([1, 2, 3])));
    expect(bytesToHex(Uint8Array.from([0, 15, 255]))).toBe("000fff");
  });
});

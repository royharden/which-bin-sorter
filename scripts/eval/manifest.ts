import { ATTRIBUTE_ORDER } from "../../src/core/rules.ts";
import type { RulesFile } from "../../src/core/rules.ts";
import type { GoldRow } from "../../src/evalkit/types.ts";
import { assertDisjointGroups } from "../../src/evalkit/split.ts";
const REQUIRED = ["photo_id", "file", "sha256", "item_id", "item_group", "true_attributes", "expected_outcome", "rule_id", "licence", "split"];
export function parseManifest(text: string, rules: RulesFile): GoldRow[] {
  const ids = new Set<string>();
  const rows = text.split(/\r?\n/).filter((l) => l.trim()).map((line, index) => {
    const raw: unknown = JSON.parse(line);
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new Error(`manifest row ${index + 1}: object required`);
    const r = raw as Record<string, unknown>;
    if (REQUIRED.some((k) => !(k in r)) || Object.keys(r).some((k) => ![...REQUIRED, "query"].includes(k))) throw new Error("manifest fields");
    for (const key of ["photo_id", "item_id", "item_group", "licence"]) if (typeof r[key] !== "string" || !(r[key] as string).trim()) throw new Error(`manifest ${key}`);
    if (!/^[a-zA-Z0-9_-]+$/.test(r.photo_id as string) || ids.has(r.photo_id as string)) throw new Error("duplicate/unsafe photo_id");
    ids.add(r.photo_id as string);
    if (r.split !== "dev" && r.split !== "heldout") throw new Error("manifest split");
    if (r.item_id !== "out_of_table" && !rules.entries.some((e) => e.id === r.item_id)) throw new Error("manifest item not in rules");
    // A real item cannot claim different groups to leak across the split.
    if (r.item_id !== "out_of_table" && r.item_group !== r.item_id) throw new Error("item group must be underlying item id");
    const attrs = r.true_attributes;
    if (typeof attrs !== "object" || attrs === null || Array.isArray(attrs) || Object.keys(attrs).length !== ATTRIBUTE_ORDER.length ||
      ATTRIBUTE_ORDER.some((k) => !Object.hasOwn(attrs, k) || ![true, false, null].includes((attrs as Record<string, boolean | null>)[k] ?? null))) throw new Error("manifest attributes");
    const outcome = r.expected_outcome;
    if (outcome !== "clarify" && outcome !== "abstain" && !rules.bins.some((b) => outcome === `answer:${b.id}`)) throw new Error("manifest expected outcome");
    if (r.rule_id !== null && (typeof r.rule_id !== "string" || !rules.entries.some((e) => r.rule_id === e.id || e.conditions.some((_, i) => r.rule_id === `${e.id}#${i}`)))) throw new Error("manifest rule_id");
    if (r.query !== undefined && (typeof r.query !== "string" || !r.query.trim())) throw new Error("manifest query");
    if (r.licence === "fixture") {
      if (r.file !== null || r.sha256 !== null) throw new Error("authored fixture must have null image and hash");
    } else if (typeof r.file !== "string" || !r.file || typeof r.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(r.sha256)) throw new Error("real manifest requires file/hash");
    return raw as GoldRow;
  });
  assertDisjointGroups(rows.filter((r) => r.split === "dev"), rows.filter((r) => r.split === "heldout"), (r) => r.item_group);
  return rows;
}

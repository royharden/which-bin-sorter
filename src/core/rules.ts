// Rules-table types (PLAN.md section 4.1). Part of the `rulestable` export.
// Pure TypeScript: no Deno/Node globals, no npm imports. Bin ids are data: they come only from a rules file.

/** The six boolean condition attributes, in the fixed clarify scan order (PLAN.md 4.4 step 7). */
export const ATTRIBUTE_ORDER = [
  "food_soiled",
  "liquid_inside",
  "has_lid",
  "contains_battery",
  "broken",
  "compostable_marking",
] as const;

export type Attr = (typeof ATTRIBUTE_ORDER)[number];

export function isAttr(value: unknown): value is Attr {
  return typeof value === "string" && (ATTRIBUTE_ORDER as readonly string[]).includes(value);
}

/** A bin id declared by the locality's rules file (`bins[].id`). Never a literal in product code. */
export type BinId = string;

export interface BinDef {
  id: BinId;
  label: string;
}

export interface Locality {
  id: string;
  name: string;
  council_url: string;
}

export type SourceKind = "council" | "fixture";

export interface RuleSource {
  kind: SourceKind;
  url: string;
  section: string;
  retrieved_on: string;
  verified_by: string;
  verified_on: string;
}

/** One `when` clause set: every listed attribute must have exactly this value. 1..n clauses. */
export type When = Partial<Record<Attr, boolean>>;

export interface Condition {
  when: When;
  /** Answer bin. A condition with no `bin` must carry `instruction` (instruction-only condition). */
  bin?: BinId;
  instruction?: string;
  /** When present, replaces the entry's `prep_steps` for answers through this condition. */
  prep_steps?: string[];
  /** Higher wins; ties go to the lower condition index. */
  priority: number;
}

export interface RuleEntry {
  id: string;
  name: string;
  aliases: string[];
  material: string;
  /** Required iff `conditions` is empty (and the entry is not `ask_council`); null otherwise. */
  bin: BinId | null;
  conditions: Condition[];
  /** Clarify text per conditioned attribute. */
  questions: Partial<Record<Attr, string>>;
  prep_steps: string[];
  ask_council: boolean;
  source: RuleSource;
}

export interface RulesFile {
  schema_version: 1;
  locality: Locality;
  bins: BinDef[];
  fixture: boolean;
  entries: RuleEntry[];
}

/** Rule id: `<entry id>` for an unconditional entry, `<entry id>#<condition index>` for a condition. */
export function ruleIdFor(entryId: string, conditionIndex: number | null): string {
  return conditionIndex === null ? entryId : `${entryId}#${conditionIndex}`;
}

/** Every rule id a rules file can produce (used by feedback validation mirrors and parity tests). */
export function allRuleIds(rules: RulesFile): string[] {
  const ids: string[] = [];
  for (const entry of rules.entries) {
    if (entry.conditions.length === 0) {
      ids.push(ruleIdFor(entry.id, null));
    } else {
      entry.conditions.forEach((_condition, index) => ids.push(ruleIdFor(entry.id, index)));
    }
  }
  return ids;
}

export function findEntry(rules: RulesFile, entryId: string): RuleEntry | undefined {
  return rules.entries.find((entry) => entry.id === entryId);
}

export function binLabel(rules: RulesFile, binId: BinId): string | undefined {
  return rules.bins.find((bin) => bin.id === binId)?.label;
}

// Rules-file validator + staleness check (PLAN.md 4.1). Part of the `rulestable` export.
// Input is untrusted JSON (`unknown`). This hand-written validator is authoritative; rules/rules.schema.json
// documents the same shape for editors and external tools.
import { ATTRIBUTE_ORDER, isAttr } from "./rules.ts";
import type { Attr, Condition, RulesFile } from "./rules.ts";
import { normalizeText } from "./search.ts";

export type ValidationMode = "fixture" | "release";
export type StalePolicy = "warn" | "fail";

export interface ValidateOptions {
  /** Reference date, `YYYY-MM-DD` (UTC). Fixed in tests so staleness is deterministic. */
  today: string;
  mode: ValidationMode;
  stale: StalePolicy;
  /** Default 180 (spec proposal). */
  maxAgeDays?: number;
}

export type IssueCode =
  | "schema"
  | "unknown_field"
  | "bad_date"
  | "bad_today"
  | "duplicate_bin"
  | "missing_source_field"
  | "unknown_bin"
  | "duplicate_alias"
  | "duplicate_id"
  | "unknown_attribute"
  | "condition_without_outcome"
  | "missing_question"
  | "contradictory_conditions"
  | "bin_presence"
  | "ask_council_shape"
  | "stale_source"
  | "release_fixture_source"
  | "release_example_url"
  | "release_fixture_flag"
  | "release_fixture_verifier";

export interface Issue {
  code: IssueCode;
  /** JSON path, e.g. `entries[3].conditions[0].when.food_soiled`. */
  path: string;
  message: string;
}

export interface ValidationReport {
  ok: boolean;
  errors: Issue[];
  warnings: Issue[];
  /** The input typed as a rules file, only when there are no errors. */
  rules: RulesFile | null;
}

export const DEFAULT_MAX_AGE_DAYS = 180;
export const FIXTURE_VERIFIER = "fixture-generator";
/** Vision candidates use `none` for "not an item in the table", so no entry may take that id. */
export const RESERVED_ITEM_ID = "none";

const TOP_KEYS = ["schema_version", "locality", "bins", "fixture", "entries"];
const LOCALITY_KEYS = ["id", "name", "council_url"];
const BIN_KEYS = ["id", "label"];
const ENTRY_KEYS = [
  "id",
  "name",
  "aliases",
  "material",
  "bin",
  "conditions",
  "questions",
  "prep_steps",
  "ask_council",
  "source",
];
const CONDITION_KEYS = ["when", "bin", "instruction", "prep_steps", "priority"];
export const SOURCE_FIELDS = ["kind", "url", "section", "retrieved_on", "verified_by", "verified_on"] as const;
const ID_PATTERN = /^[a-z][a-z0-9_]*$/;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

type Rec = Record<string, unknown>;

function isRecord(value: unknown): value is Rec {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => isNonEmptyString(item));
}

/** Days since the Unix epoch for a valid `YYYY-MM-DD` calendar date (UTC), else null. */
export function parseIsoDate(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const match = DATE_PATTERN.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const ms = Date.UTC(year, month - 1, day);
  const date = new Date(ms);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return Math.round(ms / 86_400_000);
}

/** Staleness check: `verifiedOn` is more than `maxAgeDays` days before `today`. Exactly `maxAgeDays` is not stale. */
export function isStale(verifiedOn: string, today: string, maxAgeDays: number = DEFAULT_MAX_AGE_DAYS): boolean {
  const verified = parseIsoDate(verifiedOn);
  const now = parseIsoDate(today);
  if (verified === null || now === null) throw new Error("isStale: dates must be YYYY-MM-DD");
  return now - verified > maxAgeDays;
}

function isHttpUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function isExampleInvalidUrl(value: string): boolean {
  try {
    const host = new URL(value).hostname.toLowerCase();
    return host === "example.invalid" || host.endsWith(".example.invalid") || host.endsWith(".invalid");
  } catch {
    return value.toLowerCase().includes("example.invalid");
  }
}

/** Outcome identity used by the contradiction check: answer bin, or instruction text. */
function conditionOutcome(condition: Condition): string {
  return condition.bin !== undefined ? `bin:${condition.bin}` : `instruction:${condition.instruction ?? ""}`;
}

/** Two `when` clause sets can both match one full attribute assignment iff no shared attribute disagrees. */
function compatible(a: Condition["when"], b: Condition["when"]): boolean {
  for (const attr of ATTRIBUTE_ORDER) {
    const left = a[attr];
    const right = b[attr];
    if (left !== undefined && right !== undefined && left !== right) return false;
  }
  return true;
}

export function validateRules(raw: unknown, options: ValidateOptions): ValidationReport {
  const errors: Issue[] = [];
  const warnings: Issue[] = [];
  const err = (code: IssueCode, path: string, message: string): void => {
    errors.push({ code, path, message });
  };
  const maxAgeDays = options.maxAgeDays ?? DEFAULT_MAX_AGE_DAYS;
  const release = options.mode === "release";

  const todayOk = parseIsoDate(options.today) !== null;
  if (!todayOk) err("bad_today", "--today", `today must be a YYYY-MM-DD date, got "${options.today}"`);

  if (!isRecord(raw)) {
    err("schema", "$", "rules file must be a JSON object");
    return { ok: false, errors, warnings, rules: null };
  }

  for (const key of Object.keys(raw)) {
    if (!TOP_KEYS.includes(key)) err("unknown_field", key, `unknown top-level field "${key}"`);
  }
  if (raw["schema_version"] !== 1) err("schema", "schema_version", "schema_version must be 1");
  if (typeof raw["fixture"] !== "boolean") err("schema", "fixture", "fixture must be a boolean");
  if (release && raw["fixture"] === true) {
    err("release_fixture_flag", "fixture", "release mode refuses a file marked fixture:true");
  }

  // Locality
  const locality = raw["locality"];
  if (!isRecord(locality)) {
    err("schema", "locality", "locality must be an object {id, name, council_url}");
  } else {
    for (const key of Object.keys(locality)) {
      if (!LOCALITY_KEYS.includes(key)) err("unknown_field", `locality.${key}`, `unknown locality field "${key}"`);
    }
    if (!isNonEmptyString(locality["id"])) err("schema", "locality.id", "locality.id must be a non-empty string");
    if (!isNonEmptyString(locality["name"])) err("schema", "locality.name", "locality.name must be a non-empty string");
    const councilUrl = locality["council_url"];
    if (!isHttpUrl(councilUrl)) {
      err("schema", "locality.council_url", "locality.council_url must be an http(s) URL");
    } else if (release && isExampleInvalidUrl(councilUrl)) {
      err("release_example_url", "locality.council_url", "release mode refuses example.invalid URLs");
    }
  }

  // Bins
  const binIds = new Set<string>();
  const bins = raw["bins"];
  if (!Array.isArray(bins) || bins.length === 0) {
    err("schema", "bins", "bins must be a non-empty array of {id, label}");
  } else {
    bins.forEach((bin: unknown, index) => {
      const path = `bins[${index}]`;
      if (!isRecord(bin)) {
        err("schema", path, "bin must be an object {id, label}");
        return;
      }
      for (const key of Object.keys(bin)) {
        if (!BIN_KEYS.includes(key)) err("unknown_field", `${path}.${key}`, `unknown bin field "${key}"`);
      }
      const id = bin["id"];
      if (typeof id !== "string" || !ID_PATTERN.test(id)) {
        err("schema", `${path}.id`, "bin id must match ^[a-z][a-z0-9_]*$");
      } else if (binIds.has(id)) {
        err("duplicate_bin", `${path}.id`, `duplicate bin id "${id}"`);
      } else {
        binIds.add(id);
      }
      if (!isNonEmptyString(bin["label"])) err("schema", `${path}.label`, "bin label must be a non-empty string");
    });
  }

  const checkBin = (value: unknown, path: string): boolean => {
    if (typeof value !== "string") {
      err("schema", path, "bin must be a string bin id");
      return false;
    }
    if (!binIds.has(value)) {
      err("unknown_bin", path, `unknown bin "${value}" (not declared in bins)`);
      return false;
    }
    return true;
  };

  // Entries
  const entries = raw["entries"];
  const entryIds = new Set<string>();
  const keyOwner = new Map<string, string>();
  if (!Array.isArray(entries) || entries.length === 0) {
    err("schema", "entries", "entries must be a non-empty array");
  } else {
    entries.forEach((entry: unknown, index) => {
      const path = `entries[${index}]`;
      if (!isRecord(entry)) {
        err("schema", path, "entry must be an object");
        return;
      }
      for (const key of Object.keys(entry)) {
        if (!ENTRY_KEYS.includes(key)) err("unknown_field", `${path}.${key}`, `unknown entry field "${key}"`);
      }

      // id
      const id = entry["id"];
      const idOk = typeof id === "string" && ID_PATTERN.test(id);
      if (!idOk) {
        err("schema", `${path}.id`, "entry id must match ^[a-z][a-z0-9_]*$");
      } else if (id === RESERVED_ITEM_ID) {
        err("schema", `${path}.id`, `entry id "${RESERVED_ITEM_ID}" is reserved for "no table item" in vision output`);
      } else if (entryIds.has(id)) {
        err("duplicate_id", `${path}.id`, `duplicate entry id "${id}"`);
      } else {
        entryIds.add(id);
      }
      const ownerId = idOk ? id : path;

      // name + aliases (normalized keys must be unique across entries)
      const name = entry["name"];
      if (!isNonEmptyString(name)) err("schema", `${path}.name`, "name must be a non-empty string");
      const aliases = entry["aliases"];
      if (!isStringArray(aliases)) err("schema", `${path}.aliases`, "aliases must be an array of non-empty strings");
      const keys: Array<[string, string]> = [];
      if (isNonEmptyString(name)) keys.push([name, `${path}.name`]);
      if (isStringArray(aliases)) aliases.forEach((alias, i) => keys.push([alias, `${path}.aliases[${i}]`]));
      for (const [text, keyPath] of keys) {
        const normalized = normalizeText(text);
        if (normalized === "") {
          err("schema", keyPath, "name/alias must contain letters or digits");
          continue;
        }
        const owner = keyOwner.get(normalized);
        if (owner !== undefined && owner !== ownerId) {
          err("duplicate_alias", keyPath, `"${text}" normalizes to "${normalized}", already used by entry "${owner}"`);
        } else {
          keyOwner.set(normalized, ownerId);
        }
      }

      if (!isNonEmptyString(entry["material"])) err("schema", `${path}.material`, "material must be a non-empty string");
      if (!isStringArray(entry["prep_steps"])) err("schema", `${path}.prep_steps`, "prep_steps must be an array of strings");
      const askCouncil = entry["ask_council"];
      if (typeof askCouncil !== "boolean") err("schema", `${path}.ask_council`, "ask_council must be a boolean");

      // questions
      const questions = entry["questions"];
      const questionAttrs = new Set<Attr>();
      if (!isRecord(questions)) {
        err("schema", `${path}.questions`, "questions must be an object {attribute: text}");
      } else {
        for (const [attr, text] of Object.entries(questions)) {
          if (!isAttr(attr)) {
            err("unknown_attribute", `${path}.questions.${attr}`, `unknown attribute "${attr}"`);
            continue;
          }
          if (!isNonEmptyString(text)) {
            err("schema", `${path}.questions.${attr}`, "question text must be a non-empty string");
            continue;
          }
          questionAttrs.add(attr);
        }
      }

      // conditions
      const conditions = entry["conditions"];
      const wellFormed: Array<{ index: number; condition: Condition }> = [];
      const conditionedAttrs = new Set<Attr>();
      if (!Array.isArray(conditions)) {
        err("schema", `${path}.conditions`, "conditions must be an array");
      } else {
        conditions.forEach((condition: unknown, ci) => {
          const cpath = `${path}.conditions[${ci}]`;
          if (!isRecord(condition)) {
            err("schema", cpath, "condition must be an object");
            return;
          }
          let ok = true;
          for (const key of Object.keys(condition)) {
            if (!CONDITION_KEYS.includes(key)) {
              err("unknown_field", `${cpath}.${key}`, `unknown condition field "${key}"`);
              ok = false;
            }
          }
          const when = condition["when"];
          const cleanWhen: Partial<Record<Attr, boolean>> = {};
          if (!isRecord(when) || Object.keys(when).length === 0) {
            err("schema", `${cpath}.when`, "when must be an object with at least one clause");
            ok = false;
          } else {
            for (const [attr, value] of Object.entries(when)) {
              if (!isAttr(attr)) {
                err("unknown_attribute", `${cpath}.when.${attr}`, `unknown attribute "${attr}"`);
                ok = false;
              } else if (typeof value !== "boolean") {
                err("schema", `${cpath}.when.${attr}`, "a when clause value must be true or false");
                ok = false;
              } else {
                cleanWhen[attr] = value;
                conditionedAttrs.add(attr);
              }
            }
          }
          const bin = condition["bin"];
          const instruction = condition["instruction"];
          const hasBin = bin !== undefined;
          const hasInstruction = instruction !== undefined;
          if (hasBin && !checkBin(bin, `${cpath}.bin`)) ok = false;
          if (hasInstruction && !isNonEmptyString(instruction)) {
            err("schema", `${cpath}.instruction`, "instruction must be a non-empty string");
            ok = false;
          }
          if (!hasBin && !hasInstruction) {
            err("condition_without_outcome", cpath, "a condition needs a bin or an instruction");
            ok = false;
          }
          const prep = condition["prep_steps"];
          if (prep !== undefined && !isStringArray(prep)) {
            err("schema", `${cpath}.prep_steps`, "prep_steps must be an array of strings");
            ok = false;
          }
          const priority = condition["priority"];
          if (typeof priority !== "number" || !Number.isInteger(priority)) {
            err("schema", `${cpath}.priority`, "priority must be an integer");
            ok = false;
          }
          if (ok) {
            const clean: Condition = { when: cleanWhen, priority: priority as number };
            if (typeof bin === "string") clean.bin = bin;
            if (typeof instruction === "string") clean.instruction = instruction;
            wellFormed.push({ index: ci, condition: clean });
          }
        });

        // bin presence: required iff no conditions (and not ask_council); null otherwise
        const bin = entry["bin"];
        if (askCouncil === true) {
          if (bin !== null || conditions.length > 0) {
            err("ask_council_shape", path, "an ask_council entry must have bin:null and no conditions (it always abstains)");
          }
        } else if (conditions.length === 0) {
          if (bin === null || bin === undefined) {
            err("bin_presence", `${path}.bin`, "an entry without conditions must name a bin");
          } else {
            checkBin(bin, `${path}.bin`);
          }
        } else if (bin !== null) {
          err("bin_presence", `${path}.bin`, "an entry with conditions must have bin:null (no default bin)");
        }

        // every conditioned attribute needs its clarify question
        for (const attr of conditionedAttrs) {
          if (!questionAttrs.has(attr)) {
            err("missing_question", `${path}.questions.${attr}`, `attribute "${attr}" is used in a condition but has no question`);
          }
        }

        // contradiction: two conditions that can both match one full assignment, equal priority, different outcomes
        for (let i = 0; i < wellFormed.length; i++) {
          for (let j = i + 1; j < wellFormed.length; j++) {
            const a = wellFormed[i];
            const b = wellFormed[j];
            if (a === undefined || b === undefined) continue;
            if (a.condition.priority !== b.condition.priority) continue;
            if (!compatible(a.condition.when, b.condition.when)) continue;
            if (conditionOutcome(a.condition) === conditionOutcome(b.condition)) continue;
            err(
              "contradictory_conditions",
              `${path}.conditions[${b.index}]`,
              `conditions ${a.index} and ${b.index} can both match one attribute assignment at priority ${a.condition.priority} with different outcomes`,
            );
          }
        }
      }

      // source
      const source = entry["source"];
      if (!isRecord(source)) {
        err("missing_source_field", `${path}.source`, "source is missing");
      } else {
        for (const key of Object.keys(source)) {
          if (!(SOURCE_FIELDS as readonly string[]).includes(key)) {
            err("unknown_field", `${path}.source.${key}`, `unknown source field "${key}"`);
          }
        }
        for (const field of SOURCE_FIELDS) {
          if (!isNonEmptyString(source[field])) {
            err("missing_source_field", `${path}.source.${field}`, `source.${field} is missing or empty`);
          }
        }
        const kind = source["kind"];
        if (isNonEmptyString(kind) && kind !== "council" && kind !== "fixture") {
          err("schema", `${path}.source.kind`, 'source.kind must be "council" or "fixture"');
        }
        const url = source["url"];
        if (isNonEmptyString(url) && !isHttpUrl(url)) err("schema", `${path}.source.url`, "source.url must be an http(s) URL");
        for (const field of ["retrieved_on", "verified_on"] as const) {
          const value = source[field];
          if (isNonEmptyString(value) && parseIsoDate(value) === null) {
            err("bad_date", `${path}.source.${field}`, `source.${field} must be a YYYY-MM-DD date`);
          }
        }
        const verifiedOn = source["verified_on"];
        if (todayOk && typeof verifiedOn === "string" && parseIsoDate(verifiedOn) !== null) {
          if (isStale(verifiedOn, options.today, maxAgeDays)) {
            const issue: Issue = {
              code: "stale_source",
              path: `${path}.source.verified_on`,
              message: `verified_on ${verifiedOn} is more than ${maxAgeDays} days before ${options.today}`,
            };
            if (options.stale === "fail") errors.push(issue);
            else warnings.push(issue);
          }
        }
        if (release) {
          if (kind === "fixture") {
            err("release_fixture_source", `${path}.source.kind`, 'release mode refuses source.kind:"fixture"');
          }
          if (isNonEmptyString(url) && isExampleInvalidUrl(url)) {
            err("release_example_url", `${path}.source.url`, "release mode refuses example.invalid URLs");
          }
          if (source["verified_by"] === FIXTURE_VERIFIER) {
            err("release_fixture_verifier", `${path}.source.verified_by`, `release mode refuses verified_by "${FIXTURE_VERIFIER}"`);
          }
        }
      }
    });
  }

  const ok = errors.length === 0;
  return { ok, errors, warnings, rules: ok ? (raw as unknown as RulesFile) : null };
}

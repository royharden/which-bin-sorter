// `cited` export: every answer carries a url#fragment pointer to its rule source (spec Exports; PLAN.md layout).
import { ruleIdFor } from "./rules.ts";
import type { RuleEntry, SourceKind } from "./rules.ts";

export interface Citation {
  rule_id: string;
  url: string;
  /** The part of `url` after `#`, or "" when the source URL has none. */
  fragment: string;
  section: string;
  verified_on: string;
  retrieved_on: string;
  source_kind: SourceKind;
  rules_version: string;
}

export function urlFragment(url: string): string {
  const hashIndex = url.indexOf("#");
  return hashIndex === -1 ? "" : url.slice(hashIndex + 1);
}

/**
 * Citation for one rule of an entry. `conditionIndex` null = the entry itself (unconditional or ask_council entry).
 */
export function citeRule(entry: RuleEntry, rulesVersion: string, conditionIndex: number | null = null): Citation {
  return {
    rule_id: ruleIdFor(entry.id, conditionIndex),
    url: entry.source.url,
    fragment: urlFragment(entry.source.url),
    section: entry.source.section,
    verified_on: entry.source.verified_on,
    retrieved_on: entry.source.retrieved_on,
    source_kind: entry.source.kind,
    rules_version: rulesVersion,
  };
}

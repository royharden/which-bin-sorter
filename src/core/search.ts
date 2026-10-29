// Typed-name search over the rules table (spec MVP item 2; PLAN.md M1 acceptance (e)). No model involved.
// Matching is by whole normalized tokens only: never substrings (prior art mapped "cell" to battery by substring).
import type { RuleEntry, RulesFile } from "./rules.ts";

/** Lowercase, strip diacritics, every run of non-alphanumerics becomes one space, trimmed. */
export function normalizeText(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function tokenize(text: string): string[] {
  const normalized = normalizeText(text);
  return normalized === "" ? [] : normalized.split(" ");
}

/** Words that never count as a match on their own. */
export const STOPWORDS: ReadonlySet<string> = new Set(["a", "an", "the", "of", "with", "and", "or", "some", "my"]);

/** Minimum token length (both sides) before a one-edit misspelling is accepted. */
export const FUZZY_MIN_LENGTH = 4;

/**
 * True when `a` and `b` are equal or one edit apart: one insertion, deletion, substitution or adjacent
 * transposition (optimal string alignment distance <= 1).
 */
export function withinOneEdit(a: string, b: string): boolean {
  if (a === b) return true;
  const lengthA = a.length;
  const lengthB = b.length;
  if (Math.abs(lengthA - lengthB) > 1) return false;
  if (lengthA === lengthB) {
    let i = 0;
    while (i < lengthA && a[i] === b[i]) i++;
    if (a.slice(i + 1) === b.slice(i + 1)) return true;
    return i + 1 < lengthA && a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2);
  }
  const shorter = lengthA < lengthB ? a : b;
  const longer = lengthA < lengthB ? b : a;
  let i = 0;
  while (i < shorter.length && shorter[i] === longer[i]) i++;
  return shorter.slice(i) === longer.slice(i + 1);
}

/** The searchable keys of an entry: its name and its aliases. */
export function entryKeys(entry: RuleEntry): string[] {
  return [entry.name, ...entry.aliases];
}

export type SearchResult =
  | { kind: "exact"; entry_id: string }
  | { kind: "candidates"; entry_ids: string[] }
  | { kind: "none" };

export const DEFAULT_CANDIDATE_LIMIT = 8;

interface Scored {
  id: string;
  matched: number;
  exact: number;
}

/**
 * 1. Exact: the normalized query equals the normalized name or an alias of exactly one entry.
 * 2. Tokens: each non-stopword query token matches an entry token exactly, or within one edit when both tokens
 *    are at least FUZZY_MIN_LENGTH long. Entries matching the most query tokens are returned (more exact matches
 *    first, then by id). Several candidates = a collision the user resolves by selecting one.
 * 3. Otherwise none.
 */
export function searchItems(rules: RulesFile, query: string, limit: number = DEFAULT_CANDIDATE_LIMIT): SearchResult {
  const normalizedQuery = normalizeText(query);
  if (normalizedQuery === "") return { kind: "none" };

  const exactIds = new Set<string>();
  for (const entry of rules.entries) {
    if (entryKeys(entry).some((key) => normalizeText(key) === normalizedQuery)) exactIds.add(entry.id);
  }
  if (exactIds.size === 1) {
    const [only] = [...exactIds];
    if (only !== undefined) return { kind: "exact", entry_id: only };
  }

  const queryTokens = [...new Set(tokenize(query).filter((token) => !STOPWORDS.has(token)))];
  if (queryTokens.length === 0) return { kind: "none" };

  const scored: Scored[] = [];
  for (const entry of rules.entries) {
    const entryTokens = new Set(entryKeys(entry).flatMap((key) => tokenize(key)));
    let matched = 0;
    let exact = 0;
    for (const token of queryTokens) {
      if (entryTokens.has(token)) {
        matched++;
        exact++;
      } else if (
        token.length >= FUZZY_MIN_LENGTH &&
        [...entryTokens].some((candidate) => candidate.length >= FUZZY_MIN_LENGTH && withinOneEdit(token, candidate))
      ) {
        matched++;
      }
    }
    if (matched > 0 || exactIds.has(entry.id)) scored.push({ id: entry.id, matched, exact });
  }
  if (scored.length === 0) return { kind: "none" };

  const best = Math.max(...scored.map((s) => s.matched));
  const top = scored
    .filter((s) => s.matched === best || exactIds.has(s.id))
    .sort((x, y) => y.exact - x.exact || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0))
    .slice(0, Math.max(1, limit))
    .map((s) => s.id);
  return { kind: "candidates", entry_ids: top };
}

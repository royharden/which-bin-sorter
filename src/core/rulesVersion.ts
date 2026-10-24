// rules_version = sha256 hex of the canonical JSON of the rules file, computed at runtime (PLAN.md 4.1).
// No generated hash is committed: generators cannot run in Dirty Mode.
import { canonicalJson, sha256Hex } from "./hash.ts";

export async function computeRulesVersion(rulesFileJson: unknown): Promise<string> {
  return sha256Hex(canonicalJson(rulesFileJson));
}

/** Display form: the first 12 hex characters. The full value is what gets stored and compared. */
export function shortRulesVersion(version: string): string {
  return version.slice(0, 12);
}

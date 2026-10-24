// Closed item list hash (PLAN.md 4.2). The browser and the function both compute it at runtime from the same ids
// (`itemIds.generated.ts`), so no hash is committed. A request whose `closed_list_hash` differs from the function's
// gets `version_mismatch`, never a guessed mapping. Allowlisted for the browser: imports only sha256.ts.
import { sha256Hex } from "./sha256.ts";

/** sha256 hex of `ids.join("\n")`, in the given order (callers pass the sorted `ITEM_IDS`). */
export function closedListHash(ids: readonly string[]): Promise<string> {
  return sha256Hex(ids.join("\n"));
}

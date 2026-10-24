import { canonicalJson, sha256Hex } from "../../src/core/hash.ts";
export interface CacheIdentity {
  provider: string;
  model_id: string;
  method_id: string;
  prompt_hash: string;
  rules_content_hash: string;
  closed_list_hash: string;
  vision_schema_version: number;
  preprocessing_version: string;
  upload_sha256: string;
}
export interface CacheRecord { identity: CacheIdentity; provenance: string; raw: unknown; cost_usd: number | null; latency_ms: number | null }
const IDENTITY_KEYS = ["provider", "model_id", "method_id", "prompt_hash", "rules_content_hash", "closed_list_hash", "vision_schema_version", "preprocessing_version", "upload_sha256"].sort();
export function assertIdentity(identity: CacheIdentity): void {
  if (canonicalJson(Object.keys(identity).sort()) !== canonicalJson(IDENTITY_KEYS)) throw new Error("cache identity requires exactly nine fields");
  for (const [key, value] of Object.entries(identity)) {
    if (key === "vision_schema_version" ? !Number.isInteger(value) || Number(value) < 1 : typeof value !== "string" || value.trim() === "") throw new Error(`invalid identity: ${key}`);
  }
}
export async function cacheKey(identity: CacheIdentity): Promise<string> { assertIdentity(identity); return sha256Hex(canonicalJson(identity)); }
export function validateCache(record: CacheRecord, identity: CacheIdentity, mode: "live" | "fixture"): CacheRecord {
  assertIdentity(identity);
  assertIdentity(record.identity);
  if (canonicalJson(record.identity) !== canonicalJson(identity)) throw new Error("cache identity mismatch");
  if (mode === "live" && record.provenance !== `live:${identity.model_id}`) throw new Error("mock or different model refused in live cache");
  for (const value of [record.cost_usd, record.latency_ms]) if (value !== null && (!Number.isFinite(value) || value < 0)) throw new Error("invalid cache measurements");
  return record;
}
export interface FixtureCache { fixture_id: string; method_id: string; provenance: "mock"; note: "authored, not recorded"; raw: unknown }
export function validateFixtureCache(record: FixtureCache, method: string, fixture: string): FixtureCache {
  if (record.fixture_id !== fixture || record.method_id !== method || record.provenance !== "mock" || record.note !== "authored, not recorded") throw new Error("fixture cache mismatch");
  return record;
}

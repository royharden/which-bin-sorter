// Idempotency digests and the client hash (PLAN.md 4.7). Server-only. Pure TypeScript (WebCrypto via sha256.ts).
// canonicalJson here is a function-folder copy of src/core/hash.ts (the function folder imports nothing outside
// itself); tests/handler.test.ts asserts both produce identical output.
import { sha256Hex } from "./sha256.ts";

/** Canonical JSON: object keys sorted by UTF-16 code unit, no whitespace, `undefined` object members omitted. */
export function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "number":
      if (!Number.isFinite(value)) throw new TypeError("canonicalJson: non-finite number");
      return JSON.stringify(value);
    case "string":
      return JSON.stringify(value);
    case "object": {
      if (Array.isArray(value)) return `[${value.map((item: unknown) => canonicalJson(item)).join(",")}]`;
      const record = value as Record<string, unknown>;
      const keys = Object.keys(record)
        .filter((key) => record[key] !== undefined)
        .sort();
      return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
    }
    default:
      throw new TypeError(`canonicalJson: unsupported value of type ${typeof value}`);
  }
}

export interface RequestDigestInput {
  readonly op: "identify";
  readonly upload_sha256: string;
  readonly model_id: string;
  readonly prompt_version: string;
  readonly closed_list_hash: string;
  readonly schema_version: number;
  readonly preprocessing_version: string;
}

/** request_digest = sha256 over the canonical JSON of exactly these seven fields. */
export function requestDigest(input: RequestDigestInput): Promise<string> {
  return sha256Hex(
    canonicalJson({
      op: input.op,
      upload_sha256: input.upload_sha256,
      model_id: input.model_id,
      prompt_version: input.prompt_version,
      closed_list_hash: input.closed_list_hash,
      schema_version: input.schema_version,
      preprocessing_version: input.preprocessing_version,
    }),
  );
}

export interface FeedbackDigestInput {
  readonly identify_request_id: string | null;
  readonly kind: string;
  readonly upload_sha256: string | null;
  // The handler's closed FeedbackOutcomeRecord interface intentionally has no open string index signature.
  // Canonicalization accepts any object here; strict outcome validation happens before this digest is built.
  readonly outcome: object;
  readonly rules_version: string;
}

/** feedback_digest binds a feedback_id (the idempotency key) to everything else the record says. */
export function feedbackDigest(input: FeedbackDigestInput): Promise<string> {
  return sha256Hex(
    canonicalJson({
      op: "feedback",
      identify_request_id: input.identify_request_id,
      kind: input.kind,
      upload_sha256: input.upload_sha256,
      outcome: input.outcome,
      rules_version: input.rules_version,
    }),
  );
}

/** The UTC calendar day of an instant, `YYYY-MM-DD`. */
export function utcDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/**
 * client_hash = sha256(trusted client address + CLIENT_HASH_SALT + UTC day), joined with "\n" so no two
 * different triples can concatenate to the same string. Raw addresses are never stored.
 */
export function clientHash(address: string, salt: string, day: string): Promise<string> {
  return sha256Hex(`${address}\n${salt}\n${day}`);
}

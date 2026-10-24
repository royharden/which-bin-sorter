// Vision provider contract (PLAN.md 4.6, 4.7). Allowlisted for the browser bundle. Types only.
// A provider returns the model's raw, UNTRUSTED output; it is never trusted until visionSchema.ts validates it.
// Nothing here carries a disposal decision: providers report what an item is, never where it goes.

export interface ProviderRequest {
  /** Base64 of the re-encoded JPEG (no data: prefix). */
  readonly image_b64: string;
  readonly media_type: "image/jpeg";
  /** The closed item list the model must pick from (sorted ITEM_IDS). */
  readonly item_ids: readonly string[];
  /** Mock selector hint (demo tiles); ignored by live providers. */
  readonly fixture_id: string | null;
  /** Untrusted sha256 of the original bytes; mock selector alias only; ignored by live providers. */
  readonly source_sha256: string | null;
}

export interface ProviderUsage {
  readonly input_tokens: number;
  readonly output_tokens: number;
}

export type ProviderFailureCode = "provider_timeout" | "provider_error";

export type ProviderResult =
  | {
      readonly ok: true;
      /** Parsed model output, or null when the model text was not a JSON object (validator then rejects it). */
      readonly raw: unknown;
      readonly usage: ProviderUsage | null;
      /** Model id the provider actually called; null for the mock. */
      readonly model_id: string | null;
    }
  | {
      readonly ok: false;
      readonly code: ProviderFailureCode;
      /** Usage when the provider reported it before failing; usually null. */
      readonly usage: ProviderUsage | null;
    };

export type ProviderKind = "mock" | "anthropic";

export interface VisionProvider {
  readonly kind: ProviderKind;
  /** Must honour `signal` (abort = timeout). Should not throw; a throw is treated as `provider_error`. */
  identify(request: ProviderRequest, signal?: AbortSignal): Promise<ProviderResult>;
}

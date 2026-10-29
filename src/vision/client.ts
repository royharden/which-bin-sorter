import { closedListHash } from "../../supabase/functions/identify/closedList.ts";
import { ITEM_IDS } from "../../supabase/functions/identify/itemIds.generated.ts";
import { createMockProvider } from "../../supabase/functions/identify/providers/mock.ts";
import { PREPROCESSING_VERSION, SCHEMA_VERSION } from "../../supabase/functions/identify/visionSchema.ts";
import type { PreparedImage } from "../intake/reencode.ts";
import type { EdgeTransport } from "../lib/supabase.ts";
import { normalizeVision } from "./normalize.ts";
import type { NormalizedVision } from "./normalize.ts";

export type PhotoProvenance = "mock" | `live:${string}`;
export type ResultProvenance = PhotoProvenance | "typed · local rules" | "live · response rejected";
export interface IdentifyInput {
  readonly image: PreparedImage;
  readonly request_id: string;
  readonly fixture_id?: string;
}
interface Metadata {
  readonly provenance: PhotoProvenance | "live · response rejected";
  readonly request_id: string;
  readonly debug: readonly string[];
}
export type IdentifyResult =
  | (Metadata & { readonly kind: "vision"; readonly value: NormalizedVision })
  | (Metadata & { readonly kind: "rejected" })
  | { readonly kind: "error"; readonly code: string; readonly message: string };
export interface VisionClient { identify(input: IdentifyInput): Promise<IdentifyResult>; }

function validated(raw: unknown, metadata: Metadata): IdentifyResult {
  const normalized = normalizeVision(raw);
  if (!normalized.ok) return { ...metadata, kind: "rejected", debug: [...metadata.debug, `vision response rejected (${normalized.reason})`] };
  return { ...metadata, kind: "vision", value: normalized.value,
    debug: [...metadata.debug, ...(normalized.value.dropped_ids.length > 0 ? ["Off-list candidates were removed by the validator."] : [])] };
}

export class LocalMockVisionClient implements VisionClient {
  async identify(input: IdentifyInput): Promise<IdentifyResult> {
    const response = await createMockProvider().identify({ image_b64: input.image.image_b64,
      media_type: "image/jpeg", item_ids: ITEM_IDS, fixture_id: input.fixture_id ?? null,
      source_sha256: input.image.source_sha256 });
    if (!response.ok) return { kind: "error", code: response.code, message: "The authored demo response could not be loaded." };
    return validated(response.raw, { provenance: "mock", request_id: input.request_id,
      debug: ["Authored mock response; no model call.", ...(input.fixture_id === undefined ? ["Demo mode only recognizes the sample tiles."] : [])] });
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export class EdgeVisionClient implements VisionClient {
  readonly transport: EdgeTransport;
  constructor(transport: EdgeTransport) { this.transport = transport; }
  async identify(input: IdentifyInput): Promise<IdentifyResult> {
    try {
      const hash = await closedListHash(ITEM_IDS);
      const raw = record(await this.transport.invoke({ op: "identify", request_id: input.request_id,
        image_b64: input.image.image_b64, source_sha256: input.image.source_sha256,
        closed_list_hash: hash, schema_version: SCHEMA_VERSION }));
      if (raw === null) return { kind: "error", code: "bad_response", message: "The service returned an unreadable response. Type the item or retry." };
      if (raw.ok !== true) {
        const code = typeof raw.code === "string" ? raw.code : "service_error";
        // Error envelopes have no model id. Do not invent a model identity for a rejected output.
        if (code === "invalid_vision_output") return { kind: "rejected", provenance: "live · response rejected",
          request_id: input.request_id, debug: [`vision response rejected (${typeof raw.detail === "string" ? raw.detail : code})`,
            ...(raw.settlement_pending === true ? ["Ledger settlement pending; operator reconciliation required."] : [])] };
        return { kind: "error", code, message: errorCopy(code) };
      }
      if (raw.provenance === "mock") return { kind: "error", code: "mock_provenance", message: "Live mode refused a mock response. Check the function configuration." };
      const model = raw.model_id;
      if (typeof model !== "string" || model.length === 0 || raw.provenance !== `live:${model}`) {
        return { kind: "error", code: "bad_provenance", message: "The service did not confirm a live model. No result was used." };
      }
      if (raw.request_id !== input.request_id || raw.schema_version !== SCHEMA_VERSION || raw.closed_list_hash !== hash ||
          raw.preprocessing_version !== PREPROCESSING_VERSION || raw.upload_sha256 !== input.image.upload_sha256) {
        return { kind: "error", code: "version_mismatch", message: "The response does not match this photo or app version. Reload the app or type the item." };
      }
      return validated(raw.vision, { provenance: `live:${model}`, request_id: input.request_id,
        debug: [raw.replayed === true ? "Server replay; no new model dispatch." : "Live identification response.",
          ...(raw.settlement_pending === true ? ["Ledger settlement pending; operator reconciliation required. No automatic retry."] : [])] });
    } catch {
      return { kind: "error", code: "network_error", message: "The service could not be reached. A retry reuses this request ID to avoid duplicate charges. You can also type the item." };
    }
  }
}

function errorCopy(code: string): string {
  const copy: Record<string, string> = {
    live_disabled: "Live identification is disabled on the server. You can still type the item.",
    live_misconfigured: "Live identification needs server setup. You can still type the item.",
    budget_exhausted: "The server's daily budget is exhausted. You can still type the item.",
    rate_limited: "The request limit has been reached. Wait before retrying, or type the item.",
    request_in_progress: "This request is still being processed. Retry later with the same request ID, or type the item.",
    provider_timeout: "Identification timed out. A charge may still be pending. Type the item or retry this same request later.",
    ledger_unavailable: "The call ledger is unavailable. Try later or type the item.",
    invalid_vision_output: "The vision response was rejected.",
  };
  return copy[code] ?? "Identification could not finish. Retry this request or type the item.";
}

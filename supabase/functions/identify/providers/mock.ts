// In-process mock vision provider (PLAN.md 4.6). Allowlisted for the browser bundle: demo mode's
// LocalMockVisionClient runs it with no network; the deployed function runs it only under FUNCTION_MOCK_MODE=true.
// It replays AUTHORED (not recorded) responses selected by fixture_id / source_sha256 alias; the output is raw and is
// validated exactly like a live response.
import { MOCK_RESPONSES, selectMockResponse } from "../mockResponses.ts";
import type { MockResponse } from "../mockResponses.ts";
import type { ProviderRequest, ProviderResult, VisionProvider } from "./types.ts";

export function createMockProvider(table: Readonly<Record<string, MockResponse>> = MOCK_RESPONSES): VisionProvider {
  return {
    kind: "mock",
    identify(request: ProviderRequest): Promise<ProviderResult> {
      const selected = selectMockResponse(request.fixture_id, request.source_sha256, table);
      // A deep copy, so a caller can never mutate the authored table.
      const raw: unknown = structuredClone(selected.response);
      return Promise.resolve({ ok: true, raw, usage: null, model_id: null });
    },
  };
}

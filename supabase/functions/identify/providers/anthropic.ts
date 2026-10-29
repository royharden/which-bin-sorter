// Anthropic Messages API vision provider (PLAN.md 4.7). Server-only (never in the browser bundle); scripts/** may
// import it for the eval. Pure TypeScript: `fetch` + AbortController only, no Deno/Node globals, no SDK.
// Key and model id are injected (the model id is not chosen yet: config/model.json `model_id: null`).
// Never executed in Dirty Mode; the request shape and token usage are verified by one budgeted call at activation
// (DEFERRED-VALIDATION #11).
import { buildIdentifyPrompt } from "../prompt.ts";
import type { ProviderRequest, ProviderResult, ProviderUsage, VisionProvider } from "./types.ts";

export const ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages";
export const ANTHROPIC_VERSION = "2023-06-01";

export interface AnthropicProviderOptions {
  readonly apiKey: string;
  readonly modelId: string;
  readonly maxTokens: number;
  readonly timeoutMs: number;
  /** Injected for tests; defaults to the global fetch. */
  readonly fetchImpl?: typeof fetch;
  readonly url?: string;
}

/** The request body sent to the Messages API (exported so tests can assert its shape without a network). */
export function buildAnthropicBody(request: ProviderRequest, modelId: string, maxTokens: number): Record<string, unknown> {
  const prompt = buildIdentifyPrompt(request.item_ids);
  return {
    model: modelId,
    max_tokens: maxTokens,
    system: prompt.system,
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: request.media_type, data: request.image_b64 } },
          { type: "text", text: prompt.user },
        ],
      },
    ],
  };
}

function readUsage(body: unknown): ProviderUsage | null {
  if (typeof body !== "object" || body === null) return null;
  const usage = (body as { usage?: unknown }).usage;
  if (typeof usage !== "object" || usage === null) return null;
  const input = (usage as { input_tokens?: unknown }).input_tokens;
  const output = (usage as { output_tokens?: unknown }).output_tokens;
  if (typeof input !== "number" || typeof output !== "number") return null;
  if (!Number.isInteger(input) || !Number.isInteger(output) || input < 0 || output < 0) return null;
  return { input_tokens: input, output_tokens: output };
}

/** Concatenated text blocks of a Messages API response, or null when there are none. */
export function readText(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const content = (body as { content?: unknown }).content;
  if (!Array.isArray(content)) return null;
  const parts: string[] = [];
  for (const block of content) {
    if (typeof block !== "object" || block === null) continue;
    const typed = block as { type?: unknown; text?: unknown };
    if (typed.type === "text" && typeof typed.text === "string") parts.push(typed.text);
  }
  return parts.length === 0 ? null : parts.join("");
}

/**
 * Parses the model text as one JSON object. Tolerates surrounding whitespace and a single markdown fence; anything
 * else (prose, two objects, truncation at max_tokens) yields null, which the validator rejects.
 */
export function parseModelJson(text: string): unknown {
  let trimmed = text.trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(trimmed);
  if (fence !== null && fence[1] !== undefined) trimmed = fence[1];
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return null;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isAbortError(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { name?: unknown }).name === "AbortError";
}

export function createAnthropicProvider(options: AnthropicProviderOptions): VisionProvider {
  const doFetch = options.fetchImpl ?? fetch;
  const url = options.url ?? ANTHROPIC_MESSAGES_URL;
  return {
    kind: "anthropic",
    async identify(request: ProviderRequest, signal?: AbortSignal): Promise<ProviderResult> {
      const controller = new AbortController();
      const onOuterAbort = (): void => controller.abort();
      if (signal !== undefined) {
        if (signal.aborted) controller.abort();
        else signal.addEventListener("abort", onOuterAbort, { once: true });
      }
      const timer = setTimeout(() => controller.abort(), options.timeoutMs);
      try {
        const response = await doFetch(url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-api-key": options.apiKey,
            "anthropic-version": ANTHROPIC_VERSION,
          },
          body: JSON.stringify(buildAnthropicBody(request, options.modelId, options.maxTokens)),
          signal: controller.signal,
        });
        let body: unknown = null;
        try {
          body = await response.json();
        } catch {
          body = null;
        }
        const usage = readUsage(body);
        if (!response.ok) return { ok: false, code: "provider_error", usage };
        const text = readText(body);
        const modelId =
          typeof body === "object" && body !== null && typeof (body as { model?: unknown }).model === "string"
            ? ((body as { model: string }).model)
            : options.modelId;
        return { ok: true, raw: text === null ? null : parseModelJson(text), usage, model_id: modelId };
      } catch (error) {
        return { ok: false, code: isAbortError(error) || controller.signal.aborted ? "provider_timeout" : "provider_error", usage: null };
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onOuterAbort);
      }
    },
  };
}

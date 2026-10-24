import { ANTHROPIC_MESSAGES_URL, ANTHROPIC_VERSION, parseModelJson, readText } from "../../supabase/functions/identify/providers/anthropic.ts";
import type { IdentifyPrompt } from "../../supabase/functions/identify/prompt.ts";
import type { BudgetSession } from "./budget.ts";

export interface EvalPrice { model_id: string; input_usd_per_mtok: number; output_usd_per_mtok: number; as_of: string; source_url: string }
export interface EvalLiveConfig { modelId: string; price: EvalPrice; maxTokens: number; timeoutMs: number; maxImageTokens: number; apiKey: string }
/** Reads root config values supplied by the CLI, never the function server mirror. No defaults for price/model. */
export function liveConfig(model: unknown, prices: unknown, runtime: unknown, env: Record<string, string | undefined>, enabled: boolean): EvalLiveConfig {
  if (!enabled || env.LIVE_MODEL_ENABLED !== "true") throw new Error("live disabled: --live and LIVE_MODEL_ENABLED=true required");
  const m = model as { provider?: string; model_id?: string; status?: string };
  const p = prices as { status?: string; entries?: EvalPrice[] };
  const r = runtime as { max_tokens?: number; provider_timeout_ms?: number; max_image_tokens?: number };
  if (m.provider !== "anthropic" || m.status !== "configured" || typeof m.model_id !== "string" || !m.model_id.trim() || !env.ANTHROPIC_API_KEY) throw new Error("live model/key unconfigured");
  const price = p.status === "verified" && Array.isArray(p.entries) ? p.entries.find((e) => e.model_id === m.model_id) : undefined;
  if (price === undefined || ![price.input_usd_per_mtok, price.output_usd_per_mtok].every((n) => Number.isFinite(n) && n > 0) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(price.as_of) || !/^https:\/\//.test(price.source_url)) throw new Error("verified sourced price required");
  if (![r.max_tokens, r.provider_timeout_ms, r.max_image_tokens].every((n) => Number.isInteger(n) && Number(n) > 0)) throw new Error("runtime token/time bounds required");
  return { modelId: m.model_id, price, maxTokens: r.max_tokens!, timeoutMs: r.provider_timeout_ms!, maxImageTokens: r.max_image_tokens!, apiKey: env.ANTHROPIC_API_KEY };
}
export function callBound(prompt: IdentifyPrompt, config: EvalLiveConfig, hasImage: boolean): number {
  // UTF-8 byte count is a conservative bound even for Unicode rules and queries.
  const text = new TextEncoder().encode(prompt.system + prompt.user).length + 64;
  const usd = ((text + (hasImage ? config.maxImageTokens : 0)) * config.price.input_usd_per_mtok + config.maxTokens * config.price.output_usd_per_mtok) / 1e6;
  return Math.ceil(usd * 1e6) / 1e6;
}
export interface TransportResult { raw: unknown; provenance: string; cost_usd: number | null; latency_ms: number; error: string | null }
export async function dispatch(prompt: IdentifyPrompt, image: string | null, config: EvalLiveConfig, budget: BudgetSession, fetchImpl: typeof fetch = fetch): Promise<TransportResult> {
  const reservation = budget.reserve(callBound(prompt, config, image !== null)); // must precede fetch
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  let actual: number | null = null;
  try {
    const content: unknown[] = [];
    if (image !== null) content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: image } });
    content.push({ type: "text", text: prompt.user });
    const response = await fetchImpl(ANTHROPIC_MESSAGES_URL, { method: "POST", headers: { "content-type": "application/json", "x-api-key": config.apiKey, "anthropic-version": ANTHROPIC_VERSION },
      body: JSON.stringify({ model: config.modelId, max_tokens: config.maxTokens, system: prompt.system, messages: [{ role: "user", content }] }), signal: controller.signal });
    const body: unknown = await response.json();
    const record = body as { model?: string; usage?: { input_tokens?: number; output_tokens?: number } };
    const input = record?.usage?.input_tokens, output = record?.usage?.output_tokens;
    if (Number.isInteger(input) && Number(input) >= 0 && Number.isInteger(output) && Number(output) >= 0) actual = (Number(input) * config.price.input_usd_per_mtok + Number(output) * config.price.output_usd_per_mtok) / 1e6;
    if (!response.ok || record?.model !== config.modelId) return { raw: null, provenance: `live:${config.modelId}`, cost_usd: actual, latency_ms: Date.now() - started, error: "provider_error_or_model_mismatch" };
    const text = readText(body);
    return { raw: text === null ? null : parseModelJson(text), provenance: `live:${config.modelId}`, cost_usd: actual, latency_ms: Date.now() - started, error: null };
  } catch {
    return { raw: null, provenance: `live:${config.modelId}`, cost_usd: null, latency_ms: Date.now() - started, error: controller.signal.aborted ? "provider_timeout" : "provider_error" };
  } finally { clearTimeout(timer); budget.settle(reservation, actual); }
}

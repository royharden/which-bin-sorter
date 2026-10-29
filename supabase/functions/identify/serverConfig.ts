// Function-side config mirror (PLAN.md 4.7, R1-1). The function folder imports nothing outside itself, so this is a
// hand-authored const mirror of config/model.json, config/prices.json and config/runtime.json (the human-facing
// sources); tests/serverConfig.test.ts asserts each mirror equals its source. Server-only: NO browser-reachable file
// imports this module (tests/static/import-boundaries.test.ts + eslint). Edit the JSON and this file together.
//
// Activation checklist (all currently fail closed -> `live_misconfigured`):
//   model.model_id set and model.status "configured"; prices.status "verified" with an entry for that model id;
//   runtime.trusted_address_source set for the platform (DEFERRED-VALIDATION #8).
import { PREPROCESSING_VERSION, SCHEMA_VERSION } from "./visionSchema.ts";

export { PREPROCESSING_VERSION, SCHEMA_VERSION };

export interface ModelConfig {
  readonly provider: "anthropic";
  readonly model_id: string | null;
  readonly prompt_version: string;
  readonly status: "unconfigured" | "configured";
}

export interface PriceEntry {
  readonly model_id: string;
  readonly input_usd_per_mtok: number;
  readonly output_usd_per_mtok: number;
  /** ISO date the price was read from the provider's published price list. */
  readonly as_of: string;
  readonly source_url: string;
}

export interface PricesConfig {
  readonly status: "unverified" | "verified";
  readonly entries: readonly PriceEntry[];
}

/** Where the trusted client address comes from on the deployed platform. Null = not pinned -> live refused. */
export interface TrustedAddressSource {
  /** Request header set by the platform edge (never by the client), e.g. a proxy's client-IP header. */
  readonly header: string;
  /** Which comma-separated element is the platform-appended one. */
  readonly pick: "only" | "leftmost" | "rightmost";
}

export interface RateLimit {
  readonly limit: number;
  readonly window_seconds: number;
}

export interface RuntimeConfig {
  readonly trusted_address_source: TrustedAddressSource | null;
  readonly rate_limits: {
    readonly identify: RateLimit;
    readonly feedback: RateLimit;
    /** Feedback window shared by every caller without a per-client identity (rate key '__global__'). */
    readonly feedback_global: RateLimit;
  };
  readonly max_tokens: number;
  readonly provider_timeout_ms: number;
  /** Request body cap including base64 overhead (1.5 MiB upload -> 2 MiB base64 + 8 KiB JSON allowance). */
  readonly body_cap_bytes: number;
  /** Decoded upload cap: 1.5 MiB. */
  readonly upload_cap_bytes: number;
  readonly max_dimension: number;
  /** Upper bound on image input tokens at <= 1024 px either side (estimate; verified at activation, #12). */
  readonly max_image_tokens: number;
  readonly max_json_depth: number;
  readonly retention_days: number;
}

export interface ServerConfig {
  readonly model: ModelConfig;
  readonly prices: PricesConfig;
  readonly runtime: RuntimeConfig;
}

/** Mirror of config/model.json. */
export const MODEL_CONFIG: ModelConfig = {
  provider: "anthropic",
  model_id: null,
  prompt_version: "identify-v1",
  status: "unconfigured",
};

/** Mirror of config/prices.json. */
export const PRICES_CONFIG: PricesConfig = {
  status: "unverified",
  entries: [],
};

/** Mirror of config/runtime.json. */
export const RUNTIME_CONFIG: RuntimeConfig = {
  trusted_address_source: null,
  rate_limits: {
    identify: { limit: 10, window_seconds: 3600 },
    feedback: { limit: 30, window_seconds: 3600 },
    feedback_global: { limit: 300, window_seconds: 3600 },
  },
  max_tokens: 400,
  provider_timeout_ms: 20000,
  body_cap_bytes: 2105344,
  upload_cap_bytes: 1572864,
  max_dimension: 1024,
  max_image_tokens: 1600,
  max_json_depth: 8,
  retention_days: 30,
};

export const SERVER_CONFIG: ServerConfig = { model: MODEL_CONFIG, prices: PRICES_CONFIG, runtime: RUNTIME_CONFIG };

/** Rate-window key for callers without a per-client identity. */
export const GLOBAL_RATE_KEY = "__global__";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function positiveFinite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/** The verified price entry for the pinned model, or null (unverified table, no entry, or a malformed entry). */
export function findVerifiedPrice(prices: PricesConfig, modelId: string | null): PriceEntry | null {
  if (prices.status !== "verified" || modelId === null) return null;
  const entry = prices.entries.find((candidate) => candidate.model_id === modelId);
  if (entry === undefined) return null;
  if (!positiveFinite(entry.input_usd_per_mtok) || !positiveFinite(entry.output_usd_per_mtok)) return null;
  if (!ISO_DATE.test(entry.as_of) || !/^https:\/\//.test(entry.source_url)) return null;
  return entry;
}

/** Rounds a USD amount UP to the next micro-dollar (reservations never under-count). */
export function ceilMicroUsd(usd: number): number {
  return Math.ceil(usd * 1e6 - 1e-9) / 1e6;
}

/**
 * Worst-case USD of one identify call: (image token bound + prompt token bound) at the input price plus
 * `max_tokens` at the output price. Computed in code from the verified price; never a guess.
 */
export function worstCaseUsd(price: PriceEntry, runtime: RuntimeConfig, promptTokens: number): number {
  const inputTokens = runtime.max_image_tokens + promptTokens;
  const usd = (inputTokens * price.input_usd_per_mtok + runtime.max_tokens * price.output_usd_per_mtok) / 1e6;
  return ceilMicroUsd(usd);
}

/** Actual cost from reported usage, or null when the provider reported none (the ledger then keeps worst case). */
export function actualCostUsd(price: PriceEntry, usage: { input_tokens: number; output_tokens: number } | null): number | null {
  if (usage === null) return null;
  return ceilMicroUsd((usage.input_tokens * price.input_usd_per_mtok + usage.output_tokens * price.output_usd_per_mtok) / 1e6);
}

/** DAILY_BUDGET_USD: a plain positive decimal (e.g. "5" or "2.50"); anything else -> null (live refused). */
export function parseBudgetUsd(raw: string | undefined): number | null {
  if (raw === undefined || !/^\d{1,6}(\.\d{1,6})?$/.test(raw.trim())) return null;
  const value = Number(raw.trim());
  return positiveFinite(value) ? value : null;
}

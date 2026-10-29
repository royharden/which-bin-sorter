// `identify` edge function handler (PLAN.md 4.7). Pure: every dependency is injected (provider, db, clock, env,
// client address, config); index.ts is the thin Deno wrapper and ledger.ts the supabase-js adapter. Server-only.
//
// identify order (fail closed; each step can only stop the request, never skip ahead):
//   1 method / CORS -> 2 body cap -> 3 parse (strict keys, bounded depth) -> 4 base64 decode, JPEG sniff, SOF
//   dimensions -> 5 recompute upload_sha256 -> 6 version checks (schema_version, closed_list_hash) -> 7 live gate
//   (FUNCTION_MOCK_MODE is evaluated here: mock path skips gate, reservation, provider and ledger) -> 8 reserve RPC
//   (any DB error -> ledger_unavailable, no provider call) -> 9 provider call with timeout + max_tokens cap ->
//   10 validate + normalize (free_label "") -> 11 settle RPC -> 12 respond.
// Provider failure / timeout settles `uncertain` and keeps the worst-case reservation. A settle failure after a
// successful call still returns the result, with `settlement_pending: true`, and never redispatches.
import { ITEM_IDS } from "./itemIds.generated.ts";
import { closedListHash } from "./closedList.ts";
import { isSha256Hex, sha256Hex } from "./sha256.ts";
import { PREPROCESSING_VERSION, SCHEMA_VERSION, validateAndNormalize } from "./visionSchema.ts";
import type { VisionOutput } from "./visionSchema.ts";
import { checkUpload } from "./imageHeader.ts";
import { clientHash, feedbackDigest, requestDigest, utcDay } from "./digest.ts";
import { corsHeaders, isOriginAllowed, parseAllowedOrigins } from "./cors.ts";
import {
  GLOBAL_RATE_KEY,
  SERVER_CONFIG,
  actualCostUsd,
  findVerifiedPrice,
  parseBudgetUsd,
  worstCaseUsd,
} from "./serverConfig.ts";
import type { PriceEntry, RateLimit, ServerConfig, TrustedAddressSource } from "./serverConfig.ts";
import { buildIdentifyPrompt, promptTokenBound } from "./prompt.ts";
import { createMockProvider } from "./providers/mock.ts";
import type { ProviderRequest, ProviderResult, VisionProvider } from "./providers/types.ts";
import { RULE_BINS, isKnownBin, isKnownEntry, isKnownReason, isKnownRule, ruleBelongsTo } from "./ruleCatalog.ts";

// -----------------------------------------------------------------------------------------------------------------
// Contract types

export type ErrorCode =
  | "bad_request"
  | "bad_image"
  | "version_mismatch"
  | "idempotency_conflict"
  | "rate_limited"
  | "budget_exhausted"
  | "live_disabled"
  | "live_misconfigured"
  | "request_in_progress"
  | "provider_timeout"
  | "provider_error"
  | "invalid_vision_output"
  | "ledger_unavailable";

export const HTTP_STATUS: Readonly<Record<ErrorCode, number>> = {
  bad_request: 400,
  bad_image: 422,
  version_mismatch: 409,
  idempotency_conflict: 409,
  rate_limited: 429,
  budget_exhausted: 429,
  live_disabled: 503,
  live_misconfigured: 503,
  request_in_progress: 409,
  provider_timeout: 504,
  provider_error: 502,
  invalid_vision_output: 502,
  ledger_unavailable: 503,
};

/** Function secrets and switches (PLAN.md 4.9). Values are read, never echoed. */
export interface HandlerEnv {
  readonly ANTHROPIC_API_KEY?: string | undefined;
  readonly CLIENT_HASH_SALT?: string | undefined;
  readonly LIVE_MODEL_ENABLED?: string | undefined;
  readonly DAILY_BUDGET_USD?: string | undefined;
  readonly ALLOWED_ORIGINS?: string | undefined;
  readonly FUNCTION_MOCK_MODE?: string | undefined;
}

/** What `call_ledger.result` holds: normalized ids / confidences / attributes / item_count only, never free_label. */
export interface StoredResult {
  readonly item_count: number;
  readonly candidates: VisionOutput["candidates"];
  readonly attributes: VisionOutput["attributes"];
}

export interface ReserveArgs {
  readonly request_id: string;
  readonly request_digest: string;
  readonly client_hash: string;
  readonly op: "identify";
  readonly provider: string;
  readonly model: string;
  readonly prompt_version: string;
  readonly closed_list_hash: string;
  readonly upload_sha256: string;
  readonly worst_case_usd: number;
  readonly cap_usd: number;
  readonly rate_limit: number;
  readonly window_seconds: number;
}

export type ReserveOutcome =
  | { readonly status: "reserved" }
  | { readonly status: "replay"; readonly result: unknown }
  | { readonly status: "in_progress" | "conflict" | "rate_limited" | "budget_exhausted" };

export type SettleStatus = "settled" | "uncertain" | "error";

export interface SettleArgs {
  readonly request_id: string;
  readonly status: SettleStatus;
  readonly input_tokens: number | null;
  readonly output_tokens: number | null;
  /** Null = unknown; the ledger then charges the worst-case reservation (settled/error) or keeps it (uncertain). */
  readonly cost_usd: number | null;
  readonly price_as_of: string | null;
  readonly latency_ms: number;
  readonly error_code: string | null;
  readonly result: StoredResult | null;
}

export type FeedbackKind = "wrong_bin" | "wrong_item" | "other";

export interface FeedbackOutcomeRecord {
  readonly type: "answer" | "clarify" | "abstain";
  readonly item_id?: string;
  readonly bin?: string;
  readonly reason_code?: string;
  readonly rule_id?: string;
}

export interface FeedbackArgs {
  readonly feedback_id: string;
  readonly feedback_digest: string;
  readonly identify_request_id: string | null;
  readonly kind: FeedbackKind;
  readonly upload_sha256: string | null;
  readonly outcome: FeedbackOutcomeRecord;
  readonly rules_version: string;
  /** Stored hash; null without a trusted per-client identity. */
  readonly client_hash: string | null;
  /** Rate-window key: the client hash, or '__global__'. */
  readonly rate_key: string;
  readonly rate_limit: number;
  readonly window_seconds: number;
}

export type FeedbackRecordStatus = "saved" | "replay" | "conflict" | "rate_limited";

/** The database seam: ledger.ts implements it over the RPCs; tests use an in-memory fake. Methods throw on DB error. */
export interface LedgerDb {
  reserve(args: ReserveArgs): Promise<ReserveOutcome>;
  settle(args: SettleArgs): Promise<void>;
  recordFeedback(args: FeedbackArgs): Promise<{ readonly status: FeedbackRecordStatus }>;
}

export interface HandlerDeps {
  /** Live provider (Anthropic); null when not constructible (missing key or model id). */
  readonly provider: VisionProvider | null;
  /** FUNCTION_MOCK_MODE provider; defaults to the authored mock. */
  readonly mockProvider?: VisionProvider;
  readonly db: LedgerDb | null;
  readonly now: () => Date;
  readonly env: HandlerEnv;
  /** Trusted client address from the pinned platform source (see `extractClientAddress`); null when unavailable. */
  readonly clientAddress: string | null;
  readonly config?: ServerConfig;
}

// -----------------------------------------------------------------------------------------------------------------
// RPC response parsing (used by ledger.ts; tested here)

const RESERVE_STATUSES = ["reserved", "replay", "in_progress", "conflict", "rate_limited", "budget_exhausted"] as const;
const FEEDBACK_STATUSES = ["saved", "replay", "conflict", "rate_limited"] as const;

/** Parses the jsonb returned by `reserve_model_call`. Throws on anything unexpected (-> ledger_unavailable). */
export function parseReserveRpc(data: unknown): ReserveOutcome {
  if (typeof data !== "object" || data === null) throw new Error("reserve_model_call: non-object response");
  const status = (data as { status?: unknown }).status;
  if (typeof status !== "string" || !(RESERVE_STATUSES as readonly string[]).includes(status)) {
    throw new Error("reserve_model_call: unknown status");
  }
  if (status === "replay") return { status, result: (data as { result?: unknown }).result ?? null };
  return { status: status as Exclude<ReserveOutcome["status"], "replay"> };
}

/** Parses the jsonb returned by `record_feedback`. Throws on anything unexpected (-> ledger_unavailable). */
export function parseFeedbackRpc(data: unknown): { status: FeedbackRecordStatus } {
  if (typeof data !== "object" || data === null) throw new Error("record_feedback: non-object response");
  const status = (data as { status?: unknown }).status;
  if (typeof status !== "string" || !(FEEDBACK_STATUSES as readonly string[]).includes(status)) {
    throw new Error("record_feedback: unknown status");
  }
  return { status: status as FeedbackRecordStatus };
}

// -----------------------------------------------------------------------------------------------------------------
// Small helpers

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FIXTURE_ID = /^[a-z0-9_]{1,64}$/;
const ADDRESS = /^[0-9A-Fa-f:.]{2,45}$/;
const FEEDBACK_KINDS: readonly FeedbackKind[] = ["wrong_bin", "wrong_item", "other"];

function isUuidV4(value: unknown): value is string {
  return typeof value === "string" && UUID_V4.test(value);
}

function nonEmpty(value: string | undefined): value is string {
  return value !== undefined && value.trim() !== "";
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function hasOnlyKeys(record: Record<string, unknown>, allowed: readonly string[], required: readonly string[]): boolean {
  for (const key of Object.keys(record)) if (!allowed.includes(key)) return false;
  for (const key of required) if (!Object.prototype.hasOwnProperty.call(record, key)) return false;
  return true;
}

function jsonResponse(
  status: number,
  body: unknown,
  cors: Record<string, string> | null,
  extra: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...(cors ?? {}),
      ...extra,
    },
  });
}

function errorResponse(
  cors: Record<string, string> | null,
  requestId: string | null,
  code: ErrorCode,
  options: { status?: number; detail?: string; headers?: Record<string, string>; settlementPending?: boolean } = {},
): Response {
  const body: Record<string, unknown> = { ok: false, request_id: requestId, code };
  if (options.detail !== undefined) body["detail"] = options.detail;
  if (options.settlementPending === true) body["settlement_pending"] = true;
  return jsonResponse(options.status ?? HTTP_STATUS[code], body, cors, options.headers);
}

/** Reads at most `cap` bytes; "too_large" as soon as the declared or streamed size exceeds it. */
export async function readBodyCapped(req: Request, cap: number): Promise<Uint8Array | "too_large"> {
  const declared = req.headers.get("content-length");
  if (declared !== null) {
    const length = Number(declared);
    if (!Number.isFinite(length) || length > cap) return "too_large";
  }
  if (req.body === null) return new Uint8Array(0);
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > cap) {
      await reader.cancel().catch(() => undefined);
      return "too_large";
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/** Strict UTF-8 + JSON object + nesting depth <= maxDepth. Null on any failure. Iterative depth walk. */
export function parseJsonBody(bytes: Uint8Array, maxDepth: number): Record<string, unknown> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return null;
  }
  if (!isPlainObject(parsed)) return null;
  const stack: Array<{ value: unknown; depth: number }> = [{ value: parsed, depth: 1 }];
  while (stack.length > 0) {
    const frame = stack.pop();
    if (frame === undefined) break;
    if (typeof frame.value !== "object" || frame.value === null) continue;
    if (frame.depth > maxDepth) return null;
    const children = Array.isArray(frame.value) ? frame.value : Object.values(frame.value);
    for (const child of children) stack.push({ value: child as unknown, depth: frame.depth + 1 });
  }
  return parsed;
}

/**
 * Trusted client address from the pinned platform source. Null when the source is not pinned, the header is
 * missing, or the picked element is not a plausible IPv4/IPv6 literal. Never trusts a client-supplied value unless
 * the platform guarantees the picked position (DEFERRED-VALIDATION #8 spoof test).
 */
export function extractClientAddress(headers: Headers, source: TrustedAddressSource | null): string | null {
  if (source === null) return null;
  const raw = headers.get(source.header);
  if (raw === null) return null;
  const parts = raw
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part !== "");
  if (parts.length === 0) return null;
  if (source.pick === "only" && parts.length !== 1) return null;
  const picked = source.pick === "rightmost" ? parts[parts.length - 1] : parts[0];
  return picked !== undefined && ADDRESS.test(picked) ? picked : null;
}

/** One dispatch with a hard timeout. Never throws; never retries. */
export async function callWithTimeout(
  provider: VisionProvider,
  request: ProviderRequest,
  timeoutMs: number,
): Promise<ProviderResult> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<ProviderResult>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve({ ok: false, code: "provider_timeout", usage: null });
    }, timeoutMs);
  });
  const call = (async (): Promise<ProviderResult> => {
    try {
      return await provider.identify(request, controller.signal);
    } catch {
      return { ok: false, code: controller.signal.aborted ? "provider_timeout" : "provider_error", usage: null };
    }
  })();
  try {
    return await Promise.race([call, timedOut]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

let closedListHashPromise: Promise<string> | null = null;

/** The function's closed-list hash, computed once per isolate from ITEM_IDS. */
export function serverClosedListHash(): Promise<string> {
  if (closedListHashPromise === null) closedListHashPromise = closedListHash(ITEM_IDS);
  return closedListHashPromise;
}

function storedResult(vision: VisionOutput): StoredResult {
  return { item_count: vision.item_count, candidates: vision.candidates, attributes: vision.attributes };
}

// -----------------------------------------------------------------------------------------------------------------
// Entry point

export async function handleRequest(req: Request, deps: HandlerDeps): Promise<Response> {
  const config = deps.config ?? SERVER_CONFIG;

  // 1 method / CORS
  const origin = req.headers.get("origin");
  if (!isOriginAllowed(origin, parseAllowedOrigins(deps.env.ALLOWED_ORIGINS))) {
    return errorResponse(null, null, "bad_request", { status: 403 });
  }
  const cors = corsHeaders(origin);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") {
    return errorResponse(cors, null, "bad_request", { status: 405, headers: { allow: "POST, OPTIONS" } });
  }

  // 2 body cap
  const body = await readBodyCapped(req, config.runtime.body_cap_bytes);
  if (body === "too_large") return errorResponse(cors, null, "bad_request", { status: 413 });

  // 3 parse
  const record = parseJsonBody(body, config.runtime.max_json_depth);
  if (record === null) return errorResponse(cors, null, "bad_request");
  if (record["op"] === "identify") return handleIdentify(record, deps, config, cors);
  if (record["op"] === "feedback") return handleFeedback(record, deps, config, cors);
  return errorResponse(cors, null, "bad_request");
}

// -----------------------------------------------------------------------------------------------------------------
// identify

interface IdentifyRequest {
  readonly request_id: string;
  readonly image_b64: string;
  readonly source_sha256: string | null;
  readonly fixture_id: string | null;
  readonly closed_list_hash: string;
  readonly schema_version: number;
}

const IDENTIFY_KEYS = ["op", "request_id", "image_b64", "source_sha256", "fixture_id", "closed_list_hash", "schema_version"];
const IDENTIFY_REQUIRED = ["op", "request_id", "image_b64", "closed_list_hash", "schema_version"];

function parseIdentify(record: Record<string, unknown>): IdentifyRequest | null {
  if (!hasOnlyKeys(record, IDENTIFY_KEYS, IDENTIFY_REQUIRED)) return null;
  const { request_id, image_b64, closed_list_hash, schema_version } = record;
  const source = record["source_sha256"] ?? null;
  const fixture = record["fixture_id"] ?? null;
  if (!isUuidV4(request_id)) return null;
  if (typeof image_b64 !== "string" || image_b64.length === 0) return null;
  if (!isSha256Hex(closed_list_hash)) return null;
  if (typeof schema_version !== "number" || !Number.isInteger(schema_version)) return null;
  if (source !== null && !isSha256Hex(source)) return null;
  if (fixture !== null && (typeof fixture !== "string" || !FIXTURE_ID.test(fixture))) return null;
  return {
    request_id: request_id.toLowerCase(),
    image_b64,
    source_sha256: source,
    fixture_id: fixture,
    closed_list_hash,
    schema_version,
  };
}

interface LiveSettings {
  readonly provider: VisionProvider;
  readonly modelId: string;
  readonly price: PriceEntry;
  readonly capUsd: number;
  readonly salt: string;
  readonly clientAddress: string;
}

function liveGate(
  deps: HandlerDeps,
  config: ServerConfig,
): { ok: true; live: LiveSettings } | { ok: false; code: "live_disabled" | "live_misconfigured" } {
  if (deps.env.LIVE_MODEL_ENABLED !== "true") return { ok: false, code: "live_disabled" };
  const misconfigured = { ok: false, code: "live_misconfigured" } as const;
  const modelId = config.model.model_id;
  if (config.model.status !== "configured" || modelId === null || modelId.trim() === "") return misconfigured;
  if (!nonEmpty(deps.env.ANTHROPIC_API_KEY) || deps.provider === null) return misconfigured;
  const price = findVerifiedPrice(config.prices, modelId);
  if (price === null) return misconfigured;
  if (config.runtime.trusted_address_source === null || deps.clientAddress === null) return misconfigured;
  const salt = deps.env.CLIENT_HASH_SALT;
  if (!nonEmpty(salt)) return misconfigured;
  const capUsd = parseBudgetUsd(deps.env.DAILY_BUDGET_USD);
  if (capUsd === null) return misconfigured;
  return { ok: true, live: { provider: deps.provider, modelId, price, capUsd, salt, clientAddress: deps.clientAddress } };
}

function identifyOk(
  cors: Record<string, string>,
  config: ServerConfig,
  fields: {
    vision: VisionOutput;
    provenance: string;
    model_id: string | null;
    closed_list_hash: string;
    upload_sha256: string;
    request_id: string;
    replayed: boolean;
    settlement_pending: boolean;
  },
): Response {
  return jsonResponse(
    200,
    {
      ok: true,
      vision: fields.vision,
      provenance: fields.provenance,
      model_id: fields.model_id,
      prompt_version: config.model.prompt_version,
      closed_list_hash: fields.closed_list_hash,
      schema_version: SCHEMA_VERSION,
      upload_sha256: fields.upload_sha256,
      request_id: fields.request_id,
      replayed: fields.replayed,
      settlement_pending: fields.settlement_pending,
      preprocessing_version: PREPROCESSING_VERSION,
    },
    cors,
  );
}

async function handleIdentify(
  record: Record<string, unknown>,
  deps: HandlerDeps,
  config: ServerConfig,
  cors: Record<string, string>,
): Promise<Response> {
  const rawId = record["request_id"];
  const echoId = isUuidV4(rawId) ? rawId.toLowerCase() : null;
  const request = parseIdentify(record);
  if (request === null) return errorResponse(cors, echoId, "bad_request");
  const rid = request.request_id;
  const runtime = config.runtime;

  // 4 decode / sniff / dimensions (before any reservation)
  const upload = checkUpload(request.image_b64, runtime);
  if (!upload.ok) return errorResponse(cors, rid, "bad_image", { detail: upload.reason });

  // 5 recompute upload_sha256 (the server never trusts a client hash of the upload)
  const uploadSha256 = await sha256Hex(upload.bytes);

  // 6 version checks
  const serverHash = await serverClosedListHash();
  if (request.schema_version !== SCHEMA_VERSION || request.closed_list_hash !== serverHash) {
    return errorResponse(cors, rid, "version_mismatch");
  }

  const providerRequest: ProviderRequest = {
    image_b64: request.image_b64,
    media_type: "image/jpeg",
    item_ids: ITEM_IDS,
    fixture_id: request.fixture_id,
    source_sha256: request.source_sha256,
  };

  // 7a FUNCTION_MOCK_MODE (activation smoke test only): no live gate, no reservation, no ledger, no rate limit.
  if (deps.env.FUNCTION_MOCK_MODE === "true") {
    const mock = deps.mockProvider ?? createMockProvider();
    const result = await callWithTimeout(mock, providerRequest, runtime.provider_timeout_ms);
    if (!result.ok) return errorResponse(cors, rid, result.code);
    const validated = validateAndNormalize(result.raw, ITEM_IDS);
    if (!validated.ok) return errorResponse(cors, rid, "invalid_vision_output", { detail: validated.error.code });
    return identifyOk(cors, config, {
      vision: validated.value,
      provenance: "mock",
      model_id: null,
      closed_list_hash: serverHash,
      upload_sha256: uploadSha256,
      request_id: rid,
      replayed: false,
      settlement_pending: false,
    });
  }

  // 7b live gate: never a mock fallback.
  const gate = liveGate(deps, config);
  if (!gate.ok) return errorResponse(cors, rid, gate.code);
  const live = gate.live;
  const provenance = `live:${live.modelId}`;

  // 8 reserve (idempotency + rate window + daily budget, one transaction in the RPC)
  const prompt = buildIdentifyPrompt(ITEM_IDS);
  const worstCase = worstCaseUsd(live.price, runtime, promptTokenBound(prompt));
  const hashedClient = await clientHash(live.clientAddress, live.salt, utcDay(deps.now()));
  const digest = await requestDigest({
    op: "identify",
    upload_sha256: uploadSha256,
    model_id: live.modelId,
    prompt_version: config.model.prompt_version,
    closed_list_hash: serverHash,
    schema_version: SCHEMA_VERSION,
    preprocessing_version: PREPROCESSING_VERSION,
  });
  const db = deps.db;
  if (db === null) return errorResponse(cors, rid, "ledger_unavailable");
  let reservation: ReserveOutcome;
  try {
    reservation = await db.reserve({
      request_id: rid,
      request_digest: digest,
      client_hash: hashedClient,
      op: "identify",
      provider: config.model.provider,
      model: live.modelId,
      prompt_version: config.model.prompt_version,
      closed_list_hash: serverHash,
      upload_sha256: uploadSha256,
      worst_case_usd: worstCase,
      cap_usd: live.capUsd,
      rate_limit: runtime.rate_limits.identify.limit,
      window_seconds: runtime.rate_limits.identify.window_seconds,
    });
  } catch {
    return errorResponse(cors, rid, "ledger_unavailable");
  }

  switch (reservation.status) {
    case "replay": {
      // Settled with a stored result: replay it (zero provider calls). Re-validated; free_label is "" by construction.
      const storedRaw = reservation.result;
      const stored = isPlainObject(storedRaw) ? { ...storedRaw, free_label: "" } : null;
      const validated = validateAndNormalize(stored, ITEM_IDS);
      if (!validated.ok) return errorResponse(cors, rid, "request_in_progress");
      return identifyOk(cors, config, {
        vision: validated.value,
        provenance,
        model_id: live.modelId,
        closed_list_hash: serverHash,
        upload_sha256: uploadSha256,
        request_id: rid,
        replayed: true,
        settlement_pending: false,
      });
    }
    case "in_progress":
      return errorResponse(cors, rid, "request_in_progress");
    case "conflict":
      return errorResponse(cors, rid, "idempotency_conflict");
    case "rate_limited":
      return errorResponse(cors, rid, "rate_limited");
    case "budget_exhausted":
      return errorResponse(cors, rid, "budget_exhausted");
    case "reserved":
      break;
  }

  // 9 provider call: exactly one dispatch, hard timeout, max_tokens capped inside the provider.
  const started = deps.now().getTime();
  // The selector hints are untrusted demo metadata. A live transport receives neither, even when injected.
  const result = await callWithTimeout(live.provider, {
    ...providerRequest,
    fixture_id: null,
    source_sha256: null,
  }, runtime.provider_timeout_ms);
  const latencyMs = Math.max(0, deps.now().getTime() - started);

  const settleQuietly = async (args: SettleArgs): Promise<boolean> => {
    try {
      await db.settle(args);
      return true;
    } catch {
      return false;
    }
  };

  if (!result.ok) {
    // Uncertain: the provider may have billed us. The worst-case reservation is kept, never auto-refunded.
    const settled = await settleQuietly({
      request_id: rid,
      status: "uncertain",
      input_tokens: result.usage?.input_tokens ?? null,
      output_tokens: result.usage?.output_tokens ?? null,
      cost_usd: null,
      price_as_of: live.price.as_of,
      latency_ms: latencyMs,
      error_code: result.code,
      result: null,
    });
    return errorResponse(cors, rid, result.code, { settlementPending: !settled });
  }

  // 10 validate + normalize (free_label blanked before the first response and before storage)
  const cost = actualCostUsd(live.price, result.usage);
  const validated = validateAndNormalize(result.raw, ITEM_IDS);
  if (!validated.ok) {
    const settled = await settleQuietly({
      request_id: rid,
      status: "error",
      input_tokens: result.usage?.input_tokens ?? null,
      output_tokens: result.usage?.output_tokens ?? null,
      cost_usd: cost,
      price_as_of: live.price.as_of,
      latency_ms: latencyMs,
      error_code: "invalid_vision_output",
      result: null,
    });
    return errorResponse(cors, rid, "invalid_vision_output", {
      detail: validated.error.code,
      settlementPending: !settled,
    });
  }

  // 11 settle; a failure here still returns the (already paid-for) result and is flagged, never redispatched.
  const settled = await settleQuietly({
    request_id: rid,
    status: "settled",
    input_tokens: result.usage?.input_tokens ?? null,
    output_tokens: result.usage?.output_tokens ?? null,
    cost_usd: cost,
    price_as_of: live.price.as_of,
    latency_ms: latencyMs,
    error_code: null,
    result: storedResult(validated.value),
  });

  // 12 respond
  return identifyOk(cors, config, {
    vision: validated.value,
    provenance,
    model_id: live.modelId,
    closed_list_hash: serverHash,
    upload_sha256: uploadSha256,
    request_id: rid,
    replayed: false,
    settlement_pending: !settled,
  });
}

// -----------------------------------------------------------------------------------------------------------------
// feedback

const FEEDBACK_KEYS = ["op", "feedback_id", "identify_request_id", "kind", "upload_sha256", "outcome", "rules_version"];
const OUTCOME_KEYS = ["type", "item_id", "bin", "reason_code", "rule_id"];

/**
 * Validates a feedback outcome against the rules mirror and returns a canonical copy. It must look exactly like
 * `serializeFeedbackOutcome` output: answer {type,item_id,bin,rule_id} with the rule's own bin; clarify
 * {type,item_id}; abstain {type,reason_code[,item_id[,rule_id]]}. No free text anywhere.
 */
export function validateFeedbackOutcome(raw: unknown): FeedbackOutcomeRecord | null {
  if (!isPlainObject(raw) || !hasOnlyKeys(raw, OUTCOME_KEYS, ["type"])) return null;
  const { type, item_id, bin, reason_code, rule_id } = raw;
  if (type === "answer") {
    if (!hasOnlyKeys(raw, ["type", "item_id", "bin", "rule_id"], ["type", "item_id", "bin", "rule_id"])) return null;
    if (!isKnownEntry(item_id) || !isKnownRule(rule_id) || !ruleBelongsTo(rule_id, item_id)) return null;
    if (!isKnownBin(bin) || RULE_BINS[rule_id] !== bin) return null;
    return { type, item_id, bin, rule_id };
  }
  if (type === "clarify") {
    if (!hasOnlyKeys(raw, ["type", "item_id"], ["type", "item_id"]) || !isKnownEntry(item_id)) return null;
    return { type, item_id };
  }
  if (type === "abstain") {
    if (!hasOnlyKeys(raw, ["type", "reason_code", "item_id", "rule_id"], ["type", "reason_code"])) return null;
    if (!isKnownReason(reason_code)) return null;
    const out: { type: "abstain"; reason_code: string; item_id?: string; rule_id?: string } = { type, reason_code };
    if (item_id !== undefined) {
      if (!isKnownEntry(item_id)) return null;
      out.item_id = item_id;
    }
    if (rule_id !== undefined) {
      if (out.item_id === undefined || !isKnownRule(rule_id) || !ruleBelongsTo(rule_id, out.item_id)) return null;
      out.rule_id = rule_id;
    }
    return out;
  }
  return null;
}

interface FeedbackRequest {
  readonly feedback_id: string;
  readonly identify_request_id: string | null;
  readonly kind: FeedbackKind;
  readonly upload_sha256: string | null;
  readonly outcome: FeedbackOutcomeRecord;
  readonly rules_version: string;
}

function parseFeedback(record: Record<string, unknown>): FeedbackRequest | null {
  if (!hasOnlyKeys(record, FEEDBACK_KEYS, FEEDBACK_KEYS)) return null;
  const { feedback_id, identify_request_id, kind, upload_sha256, outcome, rules_version } = record;
  if (!isUuidV4(feedback_id)) return null;
  if (identify_request_id !== null && !isUuidV4(identify_request_id)) return null;
  if (typeof kind !== "string" || !(FEEDBACK_KINDS as readonly string[]).includes(kind)) return null;
  if (upload_sha256 !== null && !isSha256Hex(upload_sha256)) return null;
  if (!isSha256Hex(rules_version)) return null;
  const validOutcome = validateFeedbackOutcome(outcome);
  if (validOutcome === null) return null;
  return {
    feedback_id: feedback_id.toLowerCase(),
    identify_request_id: identify_request_id === null ? null : identify_request_id.toLowerCase(),
    kind: kind as FeedbackKind,
    upload_sha256,
    outcome: validOutcome,
    rules_version,
  };
}

async function handleFeedback(
  record: Record<string, unknown>,
  deps: HandlerDeps,
  config: ServerConfig,
  cors: Record<string, string>,
): Promise<Response> {
  const request = parseFeedback(record);
  if (request === null) return errorResponse(cors, null, "bad_request");
  const runtime = config.runtime;

  // Per-client window only with a trusted identity; otherwise client_hash stays null and the global window applies.
  let storedClientHash: string | null = null;
  let rateKey = GLOBAL_RATE_KEY;
  let limit: RateLimit = runtime.rate_limits.feedback_global;
  const salt = deps.env.CLIENT_HASH_SALT;
  if (runtime.trusted_address_source !== null && deps.clientAddress !== null && nonEmpty(salt)) {
    storedClientHash = await clientHash(deps.clientAddress, salt, utcDay(deps.now()));
    rateKey = storedClientHash;
    limit = runtime.rate_limits.feedback;
  }

  const digest = await feedbackDigest({
    identify_request_id: request.identify_request_id,
    kind: request.kind,
    upload_sha256: request.upload_sha256,
    outcome: request.outcome,
    rules_version: request.rules_version,
  });

  const db = deps.db;
  if (db === null) return errorResponse(cors, null, "ledger_unavailable");
  let outcome: { readonly status: FeedbackRecordStatus };
  try {
    outcome = await db.recordFeedback({
      feedback_id: request.feedback_id,
      feedback_digest: digest,
      identify_request_id: request.identify_request_id,
      kind: request.kind,
      upload_sha256: request.upload_sha256,
      outcome: request.outcome,
      rules_version: request.rules_version,
      client_hash: storedClientHash,
      rate_key: rateKey,
      rate_limit: limit.limit,
      window_seconds: limit.window_seconds,
    });
  } catch {
    return errorResponse(cors, null, "ledger_unavailable");
  }
  switch (outcome.status) {
    case "saved":
    case "replay":
      // "saved" is only ever claimed after the durable insert (or its earlier, identical replay).
      return jsonResponse(200, { ok: true, feedback_id: request.feedback_id, saved: true }, cors);
    case "conflict":
      return errorResponse(cors, null, "idempotency_conflict");
    case "rate_limited":
      return errorResponse(cors, null, "rate_limited");
  }
}

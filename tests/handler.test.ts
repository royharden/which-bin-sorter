// M2 acceptance (b): the identify / feedback handler (PLAN.md 4.7) with an injected stub provider and the in-memory
// FakeLedger (same interface as ledger.ts). Covers the exact fail-closed order, every [C] M2 case, the one-row-per-
// dispatch ledger invariant, FUNCTION_MOCK_MODE, feedback idempotency / rate keys, and CORS.
import { describe, expect, it } from "vitest";
import {
  HTTP_STATUS,
  callWithTimeout,
  extractClientAddress,
  handleRequest,
  parseFeedbackRpc,
  parseJsonBody,
  parseReserveRpc,
  validateFeedbackOutcome,
} from "../supabase/functions/identify/handler.ts";
import type { HandlerDeps, HandlerEnv } from "../supabase/functions/identify/handler.ts";
import { RUNTIME_CONFIG, SERVER_CONFIG } from "../supabase/functions/identify/serverConfig.ts";
import type { ServerConfig } from "../supabase/functions/identify/serverConfig.ts";
import { ITEM_IDS } from "../supabase/functions/identify/itemIds.generated.ts";
import { closedListHash } from "../supabase/functions/identify/closedList.ts";
import { canonicalJson as functionCanonicalJson, clientHash, requestDigest } from "../supabase/functions/identify/digest.ts";
import type { ProviderRequest, ProviderResult, VisionProvider } from "../supabase/functions/identify/providers/types.ts";
import { canonicalJson as coreCanonicalJson } from "../src/core/hash.ts";
import { serializeFeedbackOutcome } from "../src/core/feedbackOutcome.ts";
import { resolve } from "../src/core/resolve.ts";
import { applyClarifyAnswer, emptyAttributes } from "../src/core/attributes.ts";
import { FakeLedger } from "./helpers/fakeLedger.ts";
import { PNG_MAGIC, buildJpeg, jpegOfSize, toBase64 } from "./helpers/jpeg.ts";
import { TEST_THRESHOLDS, fixtureRules } from "./helpers/fixtureRules.ts";

// ---------------------------------------------------------------------------------------------------------------
// Fixtures

const ORIGIN = "https://app.example.test";
const URL_ = "https://fn.example.test/functions/v1/identify";
const RID = "3f1c2d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
const RID2 = "7a8b9c0d-1e2f-4a3b-9c4d-5e6f7a8b9c0d";
const FID = "0b9a8c7d-6e5f-4d3c-a2b1-c0d9e8f7a6b5";
const RULES_VERSION = "a".repeat(64);
const CLIENT_IP = "203.0.113.7";
const NOW = new Date("2026-10-24T12:00:00Z");

const LIVE_CONFIG: ServerConfig = {
  model: { provider: "anthropic", model_id: "test-model", prompt_version: "identify-v1", status: "configured" },
  prices: {
    status: "verified",
    entries: [
      {
        model_id: "test-model",
        input_usd_per_mtok: 1,
        output_usd_per_mtok: 5,
        as_of: "2026-10-01",
        source_url: "https://example.invalid/pricing",
      },
    ],
  },
  runtime: {
    ...RUNTIME_CONFIG,
    trusted_address_source: { header: "x-test-client-ip", pick: "only" },
    provider_timeout_ms: 30,
  },
};

/** Placeholder values only: no real credentials anywhere in tests. */
const LIVE_ENV: HandlerEnv = {
  ANTHROPIC_API_KEY: "placeholder-not-a-key",
  CLIENT_HASH_SALT: "placeholder-salt",
  LIVE_MODEL_ENABLED: "true",
  DAILY_BUDGET_USD: "5",
  ALLOWED_ORIGINS: `${ORIGIN}, https://other.example.test`,
};

const GOOD_JPEG_B64 = toBase64(buildJpeg({ width: 640, height: 480 }));
const OTHER_JPEG_B64 = toBase64(buildJpeg({ width: 800, height: 600 }));

const GOOD_VISION = {
  item_count: 1,
  candidates: [{ item_id: "pizza_box", confidence: 0.86 }],
  free_label: "greasy pizza box from the model",
  attributes: {
    food_soiled: null,
    liquid_inside: null,
    has_lid: null,
    contains_battery: null,
    broken: null,
    compostable_marking: null,
    image_quality: "good",
  },
};

type Behaviour = "ok" | "timeout" | "error" | "throw" | { raw: unknown };

class StubProvider implements VisionProvider {
  readonly kind = "anthropic" as const;
  calls = 0;
  readonly requests: ProviderRequest[] = [];
  behaviour: Behaviour;

  constructor(behaviour: Behaviour = "ok") {
    this.behaviour = behaviour;
  }

  identify(request: ProviderRequest, signal?: AbortSignal): Promise<ProviderResult> {
    this.calls++;
    this.requests.push(request);
    const behaviour = this.behaviour;
    if (behaviour === "timeout") {
      // Never resolves on its own; only the handler's timeout ends it.
      return new Promise<ProviderResult>((resolvePromise) => {
        signal?.addEventListener("abort", () => resolvePromise({ ok: false, code: "provider_timeout", usage: null }));
      });
    }
    if (behaviour === "error") return Promise.resolve({ ok: false, code: "provider_error", usage: null });
    if (behaviour === "throw") return Promise.reject(new Error("socket hang up"));
    const raw = behaviour === "ok" ? structuredClone(GOOD_VISION) : behaviour.raw;
    return Promise.resolve({ ok: true, raw, usage: { input_tokens: 2000, output_tokens: 120 }, model_id: "test-model" });
  }
}

interface Harness {
  provider: StubProvider;
  mock: StubProvider;
  db: FakeLedger;
  deps: HandlerDeps;
}

function harness(
  options: {
    env?: HandlerEnv;
    config?: ServerConfig;
    behaviour?: Behaviour;
    provider?: "none";
    db?: "none";
    clientAddress?: string | null;
  } = {},
): Harness {
  const provider = new StubProvider(options.behaviour ?? "ok");
  const mock = new StubProvider({ raw: structuredClone(GOOD_VISION) });
  const db = new FakeLedger(() => NOW);
  const deps: HandlerDeps = {
    provider: options.provider === "none" ? null : provider,
    mockProvider: mock,
    db: options.db === "none" ? null : db,
    now: () => NOW,
    env: options.env ?? LIVE_ENV,
    clientAddress: options.clientAddress === undefined ? CLIENT_IP : options.clientAddress,
    config: options.config ?? LIVE_CONFIG,
  };
  return { provider, mock, db, deps };
}

let serverHash: string | null = null;
async function listHash(): Promise<string> {
  if (serverHash === null) serverHash = await closedListHash(ITEM_IDS);
  return serverHash;
}

async function identifyBody(overrides: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  return {
    op: "identify",
    request_id: RID,
    image_b64: GOOD_JPEG_B64,
    source_sha256: null,
    fixture_id: null,
    closed_list_hash: await listHash(),
    schema_version: 1,
    ...overrides,
  };
}

function post(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(URL_, {
    method: "POST",
    headers: { origin: ORIGIN, "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

async function call(h: Harness, request: Request): Promise<{ status: number; body: Record<string, unknown>; headers: Headers }> {
  const response = await handleRequest(request, h.deps);
  const text = await response.text();
  return { status: response.status, body: text === "" ? {} : (JSON.parse(text) as Record<string, unknown>), headers: response.headers };
}

async function identify(h: Harness, overrides: Record<string, unknown> = {}) {
  return call(h, post(await identifyBody(overrides)));
}

function feedbackBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    op: "feedback",
    feedback_id: FID,
    identify_request_id: RID,
    kind: "wrong_bin",
    upload_sha256: null,
    outcome: { type: "answer", item_id: "pizza_box", bin: "food_and_garden", rule_id: "pizza_box#0" },
    rules_version: RULES_VERSION,
    ...overrides,
  };
}

function rowsByStatus(db: FakeLedger): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of db.rows.values()) out[row.status] = (out[row.status] ?? 0) + 1;
  return out;
}

// ---------------------------------------------------------------------------------------------------------------

describe("test harness sanity", () => {
  it("the Request keeps the Origin header (the handler's CORS check depends on it)", () => {
    expect(post({}).headers.get("origin")).toBe(ORIGIN);
  });
});

describe("1 method / CORS", () => {
  it("answers an allowed preflight with 204 and exact-origin CORS headers", async () => {
    const h = harness();
    const response = await handleRequest(new Request(URL_, { method: "OPTIONS", headers: { origin: ORIGIN } }), h.deps);
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    expect(response.headers.get("access-control-allow-methods")).toBe("POST, OPTIONS");
    expect(response.headers.get("vary")).toBe("Origin");
  });

  it("refuses a preflight or POST from an origin not on ALLOWED_ORIGINS (403, no CORS headers)", async () => {
    const h = harness();
    const preflight = await handleRequest(
      new Request(URL_, { method: "OPTIONS", headers: { origin: "https://evil.example.test" } }),
      h.deps,
    );
    expect(preflight.status).toBe(403);
    expect(preflight.headers.get("access-control-allow-origin")).toBeNull();
    const postResult = await call(h, post(await identifyBody(), { origin: "https://evil.example.test" }));
    expect(postResult.status).toBe(403);
    expect(postResult.body).toEqual({ ok: false, request_id: null, code: "bad_request" });
    expect(h.provider.calls + h.db.calls.reserve).toBe(0);
  });

  it("fails closed when ALLOWED_ORIGINS is unset", async () => {
    const h = harness({ env: { ...LIVE_ENV, ALLOWED_ORIGINS: undefined } });
    expect((await identify(h)).status).toBe(403);
  });

  it("rejects methods other than POST and OPTIONS with 405", async () => {
    const h = harness();
    const result = await call(h, new Request(URL_, { method: "GET", headers: { origin: ORIGIN } }));
    expect(result.status).toBe(405);
    expect(result.headers.get("allow")).toBe("POST, OPTIONS");
  });
});

describe("2 body cap, 3 parse", () => {
  it("rejects a body over the cap with 413 before parsing", async () => {
    const h = harness({ config: { ...LIVE_CONFIG, runtime: { ...LIVE_CONFIG.runtime, body_cap_bytes: 512 } } });
    const result = await identify(h);
    expect(result.status).toBe(413);
    expect(result.body["code"]).toBe("bad_request");
    expect(h.db.calls.reserve).toBe(0);
  });

  it("rejects a declared content-length over the cap", async () => {
    const h = harness();
    const result = await call(h, post("{}", { "content-length": String(RUNTIME_CONFIG.body_cap_bytes + 1) }));
    expect(result.status).toBe(413);
  });

  it.each<[string, string]>([
    ["invalid JSON", "{not json"],
    ["a JSON array", "[]"],
    ["unknown op", JSON.stringify({ op: "delete" })],
  ])("rejects %s", async (_name, raw) => {
    const result = await call(harness(), post(raw));
    expect(result.status).toBe(400);
    expect(result.body).toEqual({ ok: false, request_id: null, code: "bad_request" });
  });

  it("rejects unknown identify fields, echoing the request id", async () => {
    const result = await identify(harness(), { prompt_version: "client-sent" });
    expect(result.body).toEqual({ ok: false, request_id: RID, code: "bad_request" });
  });

  it.each<[string, Record<string, unknown>]>([
    ["non-v4 request id", { request_id: "not-a-uuid" }],
    ["missing image", { image_b64: "" }],
    ["malformed closed_list_hash", { closed_list_hash: "abc" }],
    ["string schema_version", { schema_version: "1" }],
    ["malformed source_sha256", { source_sha256: "xyz" }],
    ["malformed fixture_id", { fixture_id: "../etc" }],
  ])("rejects %s", async (_name, overrides) => {
    expect((await identify(harness(), overrides)).body["code"]).toBe("bad_request");
  });

  it("bounds JSON depth", () => {
    let deep: unknown = 1;
    for (let i = 0; i < 20; i++) deep = [deep];
    expect(parseJsonBody(new TextEncoder().encode(JSON.stringify({ op: "x", deep })), 8)).toBeNull();
    expect(parseJsonBody(new TextEncoder().encode(JSON.stringify({ op: "x", a: { b: 1 } })), 8)).toEqual({ op: "x", a: { b: 1 } });
    expect(parseJsonBody(Uint8Array.from([0xff, 0xfe]), 8)).toBeNull();
  });
});

describe("4 image bounds before any reservation", () => {
  it.each<[string, string]>([
    [">1024 px", toBase64(buildJpeg({ width: 1200, height: 900 }))],
    [">1.5 MB decoded", toBase64(jpegOfSize(RUNTIME_CONFIG.upload_cap_bytes + 36))],
    ["PNG instead of JPEG", toBase64(PNG_MAGIC)],
    ["multi-frame JPEG", toBase64(buildJpeg({ secondFrame: true }))],
    ["broken base64", "%%%%"],
  ])("%s -> bad_image, no reserve, no provider call", async (_name, image) => {
    const h = harness();
    const result = await identify(h, { image_b64: image });
    expect(result.status).toBe(422);
    expect(result.body["code"]).toBe("bad_image");
    expect(h.db.calls.reserve).toBe(0);
    expect(h.provider.calls).toBe(0);
  });

  it("bad_image wins over a version mismatch (step 4 before step 6)", async () => {
    const result = await identify(harness(), { image_b64: toBase64(PNG_MAGIC), schema_version: 2 });
    expect(result.body["code"]).toBe("bad_image");
  });
});

describe("6 version checks", () => {
  it("a different closed_list_hash -> version_mismatch, never a guessed mapping", async () => {
    const h = harness();
    const result = await identify(h, { closed_list_hash: "0".repeat(64) });
    expect(result.status).toBe(409);
    expect(result.body).toEqual({ ok: false, request_id: RID, code: "version_mismatch" });
    expect(h.db.calls.reserve + h.provider.calls).toBe(0);
  });

  it("schema_version other than 1 -> version_mismatch", async () => {
    expect((await identify(harness(), { schema_version: 2 })).body["code"]).toBe("version_mismatch");
  });

  it("version_mismatch wins over live_disabled (step 6 before step 7)", async () => {
    const h = harness({ env: { ALLOWED_ORIGINS: ORIGIN } });
    expect((await identify(h, { schema_version: 2 })).body["code"]).toBe("version_mismatch");
  });
});

describe("7 live gate", () => {
  it("LIVE_MODEL_ENABLED unset -> live_disabled, no mock fallback, no reserve, no provider call", async () => {
    const h = harness({ env: { ...LIVE_ENV, LIVE_MODEL_ENABLED: undefined } });
    const result = await identify(h);
    expect(result.status).toBe(503);
    expect(result.body).toEqual({ ok: false, request_id: RID, code: "live_disabled" });
    expect(h.provider.calls).toBe(0);
    expect(h.mock.calls).toBe(0);
    expect(h.db.calls.reserve).toBe(0);
  });

  it("the shipped config refuses live even when enabled (model id unset, prices unverified, no address source)", async () => {
    const h = harness({ config: SERVER_CONFIG });
    expect((await identify(h)).body["code"]).toBe("live_misconfigured");
    expect(h.db.calls.reserve).toBe(0);
  });

  const misconfigurations: Array<[string, Parameters<typeof harness>[0]]> = [
    ["missing ANTHROPIC_API_KEY", { env: { ...LIVE_ENV, ANTHROPIC_API_KEY: undefined } }],
    ["blank ANTHROPIC_API_KEY", { env: { ...LIVE_ENV, ANTHROPIC_API_KEY: "  " } }],
    ["no provider constructed", { provider: "none" }],
    ["model id null", { config: { ...LIVE_CONFIG, model: { ...LIVE_CONFIG.model, model_id: null } } }],
    ["model status unconfigured", { config: { ...LIVE_CONFIG, model: { ...LIVE_CONFIG.model, status: "unconfigured" } } }],
    ["prices unverified", { config: { ...LIVE_CONFIG, prices: { ...LIVE_CONFIG.prices, status: "unverified" } } }],
    ["no price entry for the pinned model", { config: { ...LIVE_CONFIG, prices: { status: "verified", entries: [] } } }],
    [
      "trusted address source not pinned",
      { config: { ...LIVE_CONFIG, runtime: { ...LIVE_CONFIG.runtime, trusted_address_source: null } } },
    ],
    ["no trusted client address on the request", { clientAddress: null }],
    ["missing CLIENT_HASH_SALT", { env: { ...LIVE_ENV, CLIENT_HASH_SALT: undefined } }],
    ["missing DAILY_BUDGET_USD", { env: { ...LIVE_ENV, DAILY_BUDGET_USD: undefined } }],
    ["malformed DAILY_BUDGET_USD", { env: { ...LIVE_ENV, DAILY_BUDGET_USD: "lots" } }],
  ];

  it.each(misconfigurations)("%s -> live_misconfigured, no reserve, no provider call", async (_name, options) => {
    const h = harness(options);
    const result = await identify(h);
    expect(result.status).toBe(503);
    expect(result.body["code"]).toBe("live_misconfigured");
    expect(h.db.calls.reserve).toBe(0);
    expect(h.provider.calls).toBe(0);
    expect(h.mock.calls).toBe(0);
  });
});

describe("8 reserve: guards and DB errors stop before the provider", () => {
  it("rate limited -> rate_limited, no provider call", async () => {
    const config: ServerConfig = {
      ...LIVE_CONFIG,
      runtime: { ...LIVE_CONFIG.runtime, rate_limits: { ...LIVE_CONFIG.runtime.rate_limits, identify: { limit: 1, window_seconds: 3600 } } },
    };
    const h = harness({ config });
    expect((await identify(h)).body["ok"]).toBe(true);
    const second = await identify(h, { request_id: RID2, image_b64: OTHER_JPEG_B64 });
    expect(second.status).toBe(429);
    expect(second.body["code"]).toBe("rate_limited");
    expect(h.provider.calls).toBe(1);
    expect(h.db.rows.size).toBe(1);
  });

  it("budget exhausted -> budget_exhausted, no provider call, no ledger row", async () => {
    const h = harness({ env: { ...LIVE_ENV, DAILY_BUDGET_USD: "0.000001" } });
    const result = await identify(h);
    expect(result.body["code"]).toBe("budget_exhausted");
    expect(h.provider.calls).toBe(0);
    expect(h.db.rows.size).toBe(0);
  });

  it("any DB error -> ledger_unavailable, no provider call", async () => {
    const h = harness();
    h.db.failReserve = true;
    const result = await identify(h);
    expect(result.status).toBe(503);
    expect(result.body["code"]).toBe("ledger_unavailable");
    expect(h.provider.calls).toBe(0);
  });

  it("no database configured -> ledger_unavailable, no provider call", async () => {
    const h = harness({ db: "none" });
    expect((await identify(h)).body["code"]).toBe("ledger_unavailable");
    expect(h.provider.calls).toBe(0);
  });

  it("sends the request digest, client hash, worst case and limits to the RPC", async () => {
    const h = harness();
    await identify(h);
    const args = h.db.reserveArgs[0];
    if (args === undefined) throw new Error("no reserve call");
    expect(args.request_id).toBe(RID);
    expect(args.client_hash).toBe(await clientHash(CLIENT_IP, "placeholder-salt", "2026-10-24"));
    expect(args.client_hash).not.toContain(CLIENT_IP);
    expect(args.cap_usd).toBe(5);
    expect(args.worst_case_usd).toBeGreaterThan(0);
    expect(args.rate_limit).toBe(10);
    expect(args.window_seconds).toBe(3600);
    expect(args.model).toBe("test-model");
    expect(args.upload_sha256).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("9-12 provider call, validation, settlement", () => {
  it("success: one provider call, one settled row, free_label blanked in the response and in storage", async () => {
    const h = harness();
    const result = await identify(h);
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      ok: true,
      provenance: "live:test-model",
      model_id: "test-model",
      prompt_version: "identify-v1",
      closed_list_hash: await listHash(),
      schema_version: 1,
      request_id: RID,
      replayed: false,
      settlement_pending: false,
      preprocessing_version: "jpeg-1024-v1",
    });
    expect((result.body["vision"] as Record<string, unknown>)["free_label"]).toBe("");
    expect(result.body["upload_sha256"]).toMatch(/^[0-9a-f]{64}$/);
    expect(h.provider.calls).toBe(1);
    const row = h.db.rows.get(RID);
    expect(row?.status).toBe("settled");
    expect(Object.keys(row?.result as Record<string, unknown>).sort()).toEqual(["attributes", "candidates", "item_count"]);
    expect(JSON.stringify(row?.result)).not.toContain("greasy pizza box from the model");
    expect(row?.cost_usd).toBeCloseTo((2000 * 1 + 120 * 5) / 1e6, 9);
  });

  it("the provider receives the closed list, the JPEG and no mock hints it could act on", async () => {
    const h = harness();
    await identify(h, { fixture_id: "pizza_box_greasy", source_sha256: "b".repeat(64) });
    const request = h.provider.requests[0];
    expect(request?.item_ids).toEqual(ITEM_IDS);
    expect(request?.media_type).toBe("image/jpeg");
    expect(request?.image_b64).toBe(GOOD_JPEG_B64);
    expect(request?.fixture_id).toBeNull();
    expect(request?.source_sha256).toBeNull();
  });

  it("settled replay: same id + same digest -> stored result, replayed:true, zero further provider calls", async () => {
    const h = harness();
    const first = await identify(h);
    const second = await identify(h);
    expect(h.provider.calls).toBe(1);
    expect(second.body["replayed"]).toBe(true);
    expect(second.body["vision"]).toEqual(first.body["vision"]);
    expect((second.body["vision"] as Record<string, unknown>)["free_label"]).toBe("");
    expect(h.db.rows.get(RID)?.replay_count).toBe(1);
  });

  it("in flight: a reserved row for the same id + digest -> request_in_progress, zero provider calls", async () => {
    const h = harness();
    h.db.failSettle = true; // leaves the first row reserved
    await identify(h);
    h.db.failSettle = false;
    const second = await identify(h);
    expect(second.status).toBe(409);
    expect(second.body).toEqual({ ok: false, request_id: RID, code: "request_in_progress" });
    expect(h.provider.calls).toBe(1);
  });

  it("digest mismatch: same id, different image -> idempotency_conflict, nothing returned", async () => {
    const h = harness();
    await identify(h);
    const second = await identify(h, { image_b64: OTHER_JPEG_B64 });
    expect(second.status).toBe(409);
    expect(second.body).toEqual({ ok: false, request_id: RID, code: "idempotency_conflict" });
    expect(second.body["vision"]).toBeUndefined();
    expect(h.provider.calls).toBe(1);
  });

  it("timeout -> provider_timeout, row uncertain, worst-case reservation kept", async () => {
    const h = harness({ behaviour: "timeout" });
    const result = await identify(h);
    expect(result.status).toBe(504);
    expect(result.body["code"]).toBe("provider_timeout");
    const row = h.db.rows.get(RID);
    expect(row?.status).toBe("uncertain");
    expect(row?.error_code).toBe("provider_timeout");
    expect(h.db.budgetFor("2026-10-24")?.reserved).toBeCloseTo(row?.reserved_usd ?? -1, 12);
    expect(h.db.budgetFor("2026-10-24")?.spent).toBe(0);
  });

  it("provider error or a throwing provider -> provider_error, row uncertain, reservation kept", async () => {
    for (const behaviour of ["error", "throw"] as const) {
      const h = harness({ behaviour });
      const result = await identify(h);
      expect(result.body["code"]).toBe("provider_error");
      expect(h.db.rows.get(RID)?.status).toBe("uncertain");
      expect(h.db.budgetFor("2026-10-24")?.reserved).toBeGreaterThan(0);
    }
  });

  it("model output with a disposal key -> invalid_vision_output (detail rejected_bin_field), row error, one call", async () => {
    const h = harness({ behaviour: { raw: { ...GOOD_VISION, bin: "recycling" } } });
    const result = await identify(h);
    expect(result.status).toBe(502);
    expect(result.body).toEqual({ ok: false, request_id: RID, code: "invalid_vision_output", detail: "rejected_bin_field" });
    expect(h.provider.calls).toBe(1);
    expect(h.db.rows.get(RID)?.status).toBe("error");
    expect(h.db.rows.get(RID)?.result).toBeNull();
  });

  it("unparseable model text (raw null) -> invalid_vision_output", async () => {
    const h = harness({ behaviour: { raw: null } });
    expect((await identify(h)).body["code"]).toBe("invalid_vision_output");
  });

  it("settle failure after success -> result + settlement_pending:true, exactly one call, one row left reserved", async () => {
    const h = harness();
    h.db.failSettle = true;
    const result = await identify(h);
    expect(result.status).toBe(200);
    expect(result.body["ok"]).toBe(true);
    expect(result.body["settlement_pending"]).toBe(true);
    expect(h.provider.calls).toBe(1);
    expect(h.db.rows.size).toBe(1);
    expect(h.db.rows.get(RID)?.status).toBe("reserved");
  });

  it("every provider dispatch leaves exactly one ledger row in a final status (except settle failure)", async () => {
    const cases: Array<[Behaviour, string]> = [
      ["ok", "settled"],
      ["timeout", "uncertain"],
      ["error", "uncertain"],
      ["throw", "uncertain"],
      [{ raw: { ...GOOD_VISION, extra: 1 } }, "error"],
    ];
    for (const [behaviour, status] of cases) {
      const h = harness({ behaviour });
      await identify(h);
      expect(h.provider.calls).toBe(1);
      expect(rowsByStatus(h.db)).toEqual({ [status]: 1 });
    }
  });

  it("flags failed settlement on error paths and keeps one reservation without redispatch", async () => {
    const cases: Behaviour[] = ["timeout", "error", "throw", { raw: { ...GOOD_VISION, bin: "garbage" } }];
    for (const behaviour of cases) {
      const h = harness({ behaviour });
      h.db.failSettle = true;
      const result = await identify(h);
      expect(result.body["ok"]).toBe(false);
      expect(result.body["settlement_pending"]).toBe(true);
      expect(rowsByStatus(h.db)).toEqual({ reserved: 1 });
      expect(h.db.calls.settle).toBe(1);
      expect((await identify(h)).body["code"]).toBe("request_in_progress");
      expect(h.provider.calls).toBe(1);
    }
  });
});

describe("FUNCTION_MOCK_MODE (activation smoke test)", () => {
  const MOCK_ENV: HandlerEnv = { ALLOWED_ORIGINS: ORIGIN, FUNCTION_MOCK_MODE: "true" };

  it("returns the authored mock, provenance mock, model_id null, with no live gate, reserve or provider call", async () => {
    const h = harness({ env: MOCK_ENV, config: SERVER_CONFIG, provider: "none" });
    h.deps = { ...h.deps, mockProvider: undefined };
    const result = await identify(h, { fixture_id: "pizza_box_greasy" });
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ ok: true, provenance: "mock", model_id: null, replayed: false });
    const vision = result.body["vision"] as { candidates: unknown; free_label: string };
    expect(vision.candidates).toEqual([{ item_id: "pizza_box", confidence: 0.86 }]);
    expect(vision.free_label).toBe("");
    expect(h.db.calls.reserve + h.db.calls.settle).toBe(0);
  });

  it("validates mock output identically: the injection fixture is rejected", async () => {
    const h = harness({ env: MOCK_ENV });
    h.deps = { ...h.deps, mockProvider: undefined };
    const result = await identify(h, { fixture_id: "injection_label" });
    expect(result.body).toEqual({ ok: false, request_id: RID, code: "invalid_vision_output", detail: "rejected_bin_field" });
    expect(h.provider.calls).toBe(0);
  });

  it("an unknown upload gets the none response", async () => {
    const h = harness({ env: MOCK_ENV });
    h.deps = { ...h.deps, mockProvider: undefined };
    const result = await identify(h);
    expect((result.body["vision"] as { item_count: number }).item_count).toBe(0);
  });

  it("still applies image and version checks", async () => {
    const h = harness({ env: MOCK_ENV });
    expect((await identify(h, { image_b64: toBase64(PNG_MAGIC) })).body["code"]).toBe("bad_image");
    expect((await identify(h, { schema_version: 2 })).body["code"]).toBe("version_mismatch");
    expect(h.mock.calls).toBe(0);
  });

  it("never rate-limits and never touches the ledger", async () => {
    const h = harness({ env: MOCK_ENV });
    for (let i = 0; i < 25; i++) expect((await identify(h)).status).toBe(200);
    expect(h.mock.calls).toBe(25);
    expect(h.provider.calls).toBe(0);
    expect(h.db.calls.reserve).toBe(0);
  });
});

describe("feedback", () => {
  it("saves once, claims saved only after the insert, global rate key and null client hash without a trusted identity", async () => {
    const h = harness({ config: SERVER_CONFIG, clientAddress: null });
    const result = await call(h, post(feedbackBody()));
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ ok: true, feedback_id: FID, saved: true });
    expect(h.db.feedbackRows.size).toBe(1);
    const args = h.db.feedbackArgs[0];
    expect(args?.client_hash).toBeNull();
    expect(args?.rate_key).toBe("__global__");
    expect(args?.rate_limit).toBe(300);
  });

  it("uses the per-client hash as the rate key with a trusted identity", async () => {
    const h = harness();
    await call(h, post(feedbackBody()));
    const args = h.db.feedbackArgs[0];
    const expected = await clientHash(CLIENT_IP, "placeholder-salt", "2026-10-24");
    expect(args?.client_hash).toBe(expected);
    expect(args?.rate_key).toBe(expected);
    expect(args?.rate_limit).toBe(30);
  });

  it("same feedback_id + same content -> same receipt, still one row", async () => {
    const h = harness();
    await call(h, post(feedbackBody()));
    const again = await call(h, post(feedbackBody()));
    expect(again.body).toEqual({ ok: true, feedback_id: FID, saved: true });
    expect(h.db.feedbackRows.size).toBe(1);
  });

  it("same feedback_id + different content -> idempotency_conflict", async () => {
    const h = harness();
    await call(h, post(feedbackBody()));
    const conflict = await call(h, post(feedbackBody({ kind: "other" })));
    expect(conflict.status).toBe(409);
    expect(conflict.body["code"]).toBe("idempotency_conflict");
  });

  it("works for the typed path (no identify request id, no upload)", async () => {
    const h = harness();
    const result = await call(
      h,
      post(feedbackBody({ identify_request_id: null, upload_sha256: null, outcome: { type: "clarify", item_id: "aerosol_can" } })),
    );
    expect(result.body["saved"]).toBe(true);
  });

  it("rate limited -> rate_limited", async () => {
    const config: ServerConfig = {
      ...SERVER_CONFIG,
      runtime: { ...RUNTIME_CONFIG, rate_limits: { ...RUNTIME_CONFIG.rate_limits, feedback_global: { limit: 1, window_seconds: 3600 } } },
    };
    const h = harness({ config, clientAddress: null });
    await call(h, post(feedbackBody()));
    const second = await call(h, post(feedbackBody({ feedback_id: "1c2b3a4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d" })));
    expect(second.status).toBe(429);
    expect(second.body["code"]).toBe("rate_limited");
  });

  it("DB error -> ledger_unavailable; no db -> ledger_unavailable", async () => {
    const h = harness();
    h.db.failFeedback = true;
    expect((await call(h, post(feedbackBody()))).body["code"]).toBe("ledger_unavailable");
    expect((await call(harness({ db: "none" }), post(feedbackBody()))).body["code"]).toBe("ledger_unavailable");
  });

  it.each<[string, Record<string, unknown>]>([
    ["unknown item id", { outcome: { type: "answer", item_id: "sofa", bin: "garbage", rule_id: "sofa" } }],
    ["bin that is not the rule's bin", { outcome: { type: "answer", item_id: "pizza_box", bin: "recycling", rule_id: "pizza_box#0" } }],
    ["unknown bin", { outcome: { type: "answer", item_id: "cardboard_box", bin: "compost", rule_id: "cardboard_box" } }],
    ["rule of another item", { outcome: { type: "answer", item_id: "pizza_box", bin: "recycling", rule_id: "cardboard_box" } }],
    ["unknown reason code", { outcome: { type: "abstain", reason_code: "model_said_so" } }],
    ["free text in the outcome", { outcome: { type: "clarify", item_id: "pizza_box", note: "it was clean" } }],
    ["free_label in the outcome", { outcome: { type: "abstain", reason_code: "no_candidate", free_label: "x" } }],
    ["a bin on an abstain", { outcome: { type: "abstain", reason_code: "no_candidate", bin: "garbage" } }],
    ["a comment field", { comment: "hello" }],
    ["unknown kind", { kind: "spam" }],
    ["non-uuid feedback id", { feedback_id: "1" }],
    ["malformed rules_version", { rules_version: "v1" }],
    ["malformed upload hash", { upload_sha256: "abc" }],
  ])("rejects %s -> bad_request, nothing stored", async (_name, overrides) => {
    const h = harness();
    const result = await call(h, post(feedbackBody(overrides)));
    expect(result.status).toBe(400);
    expect(result.body["code"]).toBe("bad_request");
    expect(h.db.calls.recordFeedback).toBe(0);
  });

  it("rejects a missing field", async () => {
    const body = feedbackBody();
    delete body["upload_sha256"];
    expect((await call(harness(), post(body))).body["code"]).toBe("bad_request");
  });

  it("accepts exactly what serializeFeedbackOutcome produces for real resolver results", () => {
    const rules = fixtureRules();
    const base = { rules, rulesVersion: RULES_VERSION, thresholds: TEST_THRESHOLDS };
    const answer = resolve({ ...base, mode: "selected", item_id: "cardboard_box", attributes: emptyAttributes() });
    const clarify = resolve({ ...base, mode: "selected", item_id: "pizza_box", attributes: emptyAttributes() });
    const ask = resolve({ ...base, mode: "selected", item_id: "paint_tin", attributes: emptyAttributes() });
    const instruction = resolve({
      ...base,
      mode: "selected",
      item_id: "gas_cylinder",
      attributes: applyClarifyAnswer(emptyAttributes(), "liquid_inside", "yes"),
    });
    const none = resolve({ ...base, mode: "selected", item_id: "none", attributes: emptyAttributes() });
    for (const result of [answer, clarify, ask, instruction, none]) {
      const serialized = serializeFeedbackOutcome(result);
      expect(validateFeedbackOutcome(JSON.parse(JSON.stringify(serialized)))).toEqual(serialized);
    }
  });
});

describe("helpers", () => {
  it("extractClientAddress honours only the pinned source", () => {
    const headers = new Headers({ "x-forwarded-for": "198.51.100.1, 203.0.113.9", "x-real": "203.0.113.7" });
    expect(extractClientAddress(headers, null)).toBeNull();
    expect(extractClientAddress(headers, { header: "x-real", pick: "only" })).toBe("203.0.113.7");
    expect(extractClientAddress(headers, { header: "x-forwarded-for", pick: "rightmost" })).toBe("203.0.113.9");
    expect(extractClientAddress(headers, { header: "x-forwarded-for", pick: "leftmost" })).toBe("198.51.100.1");
    expect(extractClientAddress(headers, { header: "x-forwarded-for", pick: "only" })).toBeNull();
    expect(extractClientAddress(headers, { header: "x-missing", pick: "only" })).toBeNull();
    expect(extractClientAddress(new Headers({ "x-real": "<script>" }), { header: "x-real", pick: "only" })).toBeNull();
  });

  it("parses RPC statuses and throws on anything else", () => {
    expect(parseReserveRpc({ status: "reserved" })).toEqual({ status: "reserved" });
    expect(parseReserveRpc({ status: "replay", result: { a: 1 } })).toEqual({ status: "replay", result: { a: 1 } });
    expect(() => parseReserveRpc({ status: "ok" })).toThrow();
    expect(() => parseReserveRpc(null)).toThrow();
    expect(parseFeedbackRpc({ status: "saved" })).toEqual({ status: "saved" });
    expect(() => parseFeedbackRpc({ status: "inserted" })).toThrow();
  });

  it("the function's canonical JSON equals the core implementation", () => {
    const samples: unknown[] = [{ b: 1, a: [true, null, "x"], c: { z: 1, y: undefined } }, [], "s", 0.5, null];
    for (const sample of samples) expect(functionCanonicalJson(sample)).toBe(coreCanonicalJson(sample));
  });

  it("the request digest covers each identity field", async () => {
    const base = {
      op: "identify" as const,
      upload_sha256: "a".repeat(64),
      model_id: "m",
      prompt_version: "identify-v1",
      closed_list_hash: "b".repeat(64),
      schema_version: 1,
      preprocessing_version: "jpeg-1024-v1",
    };
    const digest = await requestDigest(base);
    for (const change of [
      { upload_sha256: "c".repeat(64) },
      { model_id: "m2" },
      { prompt_version: "identify-v2" },
      { closed_list_hash: "d".repeat(64) },
      { schema_version: 2 },
      { preprocessing_version: "jpeg-512-v1" },
    ]) {
      expect(await requestDigest({ ...base, ...change })).not.toBe(digest);
    }
  });

  it("callWithTimeout never throws and maps a timeout", async () => {
    const hanging = new StubProvider("timeout");
    const request: ProviderRequest = { image_b64: "", media_type: "image/jpeg", item_ids: [], fixture_id: null, source_sha256: null };
    expect(await callWithTimeout(hanging, request, 5)).toEqual({ ok: false, code: "provider_timeout", usage: null });
    expect(await callWithTimeout(new StubProvider("throw"), request, 1000)).toEqual({ ok: false, code: "provider_error", usage: null });
  });

  it("maps every error code to an HTTP status", () => {
    expect(Object.keys(HTTP_STATUS)).toHaveLength(13);
  });
});

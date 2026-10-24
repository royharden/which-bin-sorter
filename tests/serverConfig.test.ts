// PLAN.md 4.7 [R1-1, R1-6, R2-5, R2-7]: serverConfig.ts mirrors config/model.json, config/prices.json and
// config/runtime.json exactly; SCHEMA_VERSION / PREPROCESSING_VERSION are re-exports of the allowlisted visionSchema.ts
// constants (the ones the browser re-encoder uses); prompt version parity; worst-case cost math; fail-closed defaults.
import { describe, expect, it } from "vitest";
import modelJson from "../config/model.json";
import pricesJson from "../config/prices.json";
import runtimeJson from "../config/runtime.json";
import {
  GLOBAL_RATE_KEY,
  MODEL_CONFIG,
  PREPROCESSING_VERSION,
  PRICES_CONFIG,
  RUNTIME_CONFIG,
  SCHEMA_VERSION,
  SERVER_CONFIG,
  actualCostUsd,
  ceilMicroUsd,
  findVerifiedPrice,
  parseBudgetUsd,
  worstCaseUsd,
} from "../supabase/functions/identify/serverConfig.ts";
import type { PriceEntry, PricesConfig } from "../supabase/functions/identify/serverConfig.ts";
import * as visionSchema from "../supabase/functions/identify/visionSchema.ts";
import { PROMPT_VERSION } from "../supabase/functions/identify/prompt.ts";

const PRICE: PriceEntry = {
  model_id: "test-model",
  input_usd_per_mtok: 1,
  output_usd_per_mtok: 5,
  as_of: "2026-10-01",
  source_url: "https://example.invalid/pricing",
};

describe("mirror parity with config/*.json", () => {
  it("MODEL_CONFIG equals config/model.json", () => {
    expect(MODEL_CONFIG).toEqual(modelJson);
  });

  it("PRICES_CONFIG equals config/prices.json", () => {
    expect(PRICES_CONFIG).toEqual(pricesJson);
  });

  it("RUNTIME_CONFIG equals config/runtime.json", () => {
    expect(RUNTIME_CONFIG).toEqual(runtimeJson);
  });

  it("SERVER_CONFIG bundles the three mirrors", () => {
    expect(SERVER_CONFIG).toEqual({ model: MODEL_CONFIG, prices: PRICES_CONFIG, runtime: RUNTIME_CONFIG });
  });
});

describe("shipped values (PLAN.md 4.7)", () => {
  it("model id is not chosen yet and prices are unverified, so live is refused", () => {
    expect(MODEL_CONFIG).toEqual({ provider: "anthropic", model_id: null, prompt_version: "identify-v1", status: "unconfigured" });
    expect(PRICES_CONFIG).toEqual({ status: "unverified", entries: [] });
    expect(findVerifiedPrice(PRICES_CONFIG, MODEL_CONFIG.model_id)).toBeNull();
    expect(RUNTIME_CONFIG.trusted_address_source).toBeNull();
  });

  it("runtime limits", () => {
    expect(RUNTIME_CONFIG.rate_limits).toEqual({
      identify: { limit: 10, window_seconds: 3600 },
      feedback: { limit: 30, window_seconds: 3600 },
      feedback_global: { limit: 300, window_seconds: 3600 },
    });
    expect(RUNTIME_CONFIG.max_tokens).toBe(400);
    expect(RUNTIME_CONFIG.provider_timeout_ms).toBe(20000);
    expect(RUNTIME_CONFIG.upload_cap_bytes).toBe(1572864);
    expect(RUNTIME_CONFIG.max_dimension).toBe(1024);
    expect(RUNTIME_CONFIG.retention_days).toBe(30);
    expect(GLOBAL_RATE_KEY).toBe("__global__");
  });

  it("the body cap covers a full-size upload in base64 plus the JSON envelope", () => {
    const base64Length = Math.ceil(RUNTIME_CONFIG.upload_cap_bytes / 3) * 4;
    expect(RUNTIME_CONFIG.body_cap_bytes).toBeGreaterThan(base64Length + 1024);
    expect(RUNTIME_CONFIG.body_cap_bytes).toBeLessThan(base64Length * 1.1);
  });
});

describe("version constants", () => {
  it("SCHEMA_VERSION and PREPROCESSING_VERSION are the allowlisted visionSchema.ts constants", () => {
    expect(SCHEMA_VERSION).toBe(1);
    expect(PREPROCESSING_VERSION).toBe("jpeg-1024-v1");
    expect(SCHEMA_VERSION).toBe(visionSchema.SCHEMA_VERSION);
    expect(PREPROCESSING_VERSION).toBe(visionSchema.PREPROCESSING_VERSION);
    // M3 adds: src/intake/reencode.ts imports PREPROCESSING_VERSION from visionSchema.ts; assert equality there.
  });

  it("the server-owned prompt version equals config/model.json", () => {
    expect(PROMPT_VERSION).toBe(MODEL_CONFIG.prompt_version);
  });
});

describe("price lookup and worst-case cost", () => {
  const verified: PricesConfig = { status: "verified", entries: [PRICE] };

  it("finds only a verified, well-formed entry for the pinned model", () => {
    expect(findVerifiedPrice(verified, "test-model")).toEqual(PRICE);
    expect(findVerifiedPrice(verified, "other-model")).toBeNull();
    expect(findVerifiedPrice(verified, null)).toBeNull();
    expect(findVerifiedPrice({ status: "unverified", entries: [PRICE] }, "test-model")).toBeNull();
    expect(findVerifiedPrice({ status: "verified", entries: [{ ...PRICE, input_usd_per_mtok: 0 }] }, "test-model")).toBeNull();
    expect(findVerifiedPrice({ status: "verified", entries: [{ ...PRICE, as_of: "soon" }] }, "test-model")).toBeNull();
  });

  it("worst case = (image bound + prompt bound) x input price + max_tokens x output price, rounded up", () => {
    // (1600 + 1000) * 1 / 1e6 + 400 * 5 / 1e6 = 0.0026 + 0.002 = 0.0046
    expect(worstCaseUsd(PRICE, RUNTIME_CONFIG, 1000)).toBeCloseTo(0.0046, 9);
    expect(worstCaseUsd(PRICE, RUNTIME_CONFIG, 1000)).toBeGreaterThanOrEqual(0.0046);
  });

  it("actual cost uses reported usage, and is null without usage", () => {
    expect(actualCostUsd(PRICE, { input_tokens: 2000, output_tokens: 100 })).toBeCloseTo(0.0025, 9);
    expect(actualCostUsd(PRICE, null)).toBeNull();
  });

  it("rounds up to the micro-dollar", () => {
    expect(ceilMicroUsd(0.0000011)).toBeCloseTo(0.000002, 12);
    expect(ceilMicroUsd(0.000002)).toBeCloseTo(0.000002, 12);
  });

  it("parses DAILY_BUDGET_USD strictly", () => {
    expect(parseBudgetUsd("5")).toBe(5);
    expect(parseBudgetUsd("2.50")).toBe(2.5);
    expect(parseBudgetUsd(undefined)).toBeNull();
    expect(parseBudgetUsd("")).toBeNull();
    expect(parseBudgetUsd("0")).toBeNull();
    expect(parseBudgetUsd("-1")).toBeNull();
    expect(parseBudgetUsd("1e3")).toBeNull();
    expect(parseBudgetUsd("five")).toBeNull();
  });
});

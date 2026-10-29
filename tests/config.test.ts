import { describe, expect, it } from "vitest";
import { readConfig } from "../src/lib/config.ts";
import { createPublicClient } from "../src/lib/supabase.ts";

describe("explicit demo/live configuration", () => {
  it("defaults to the local demo, with no Supabase client", () => {
    expect(readConfig({}).mode).toBe("demo");
    expect(createPublicClient(readConfig({}))).toBeNull();
  });
  it("keeps incomplete live mode in setup and rejects invalid URLs/mode typos", () => {
    const missing = readConfig({ VITE_APP_MODE: "live" });
    expect(missing.mode).toBe("live");
    expect(missing.setupIssues).toHaveLength(2);
    expect(createPublicClient(missing)).toBeNull();
    expect(readConfig({ VITE_APP_MODE: "live", VITE_SUPABASE_URL: "http://example.invalid", VITE_SUPABASE_ANON_KEY: "public-placeholder" }).setupIssues).toContain("VITE_SUPABASE_URL must use HTTPS.");
    expect(readConfig({ VITE_APP_MODE: "lve" }).setupIssues).not.toEqual([]);
  });
});

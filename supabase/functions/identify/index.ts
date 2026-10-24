// Deno-only entry point for the `identify` edge function (PLAN.md 4.7): a thin Deno.serve wrapper that reads env,
// builds the injected dependencies and delegates to the pure handler. Excluded from tsconfig / eslint / coverage;
// type-checked by `deno check` (DEFERRED-VALIDATION #2). Never falls back to mock: the mock path runs only when
// FUNCTION_MOCK_MODE=true (activation smoke test), and the handler decides that.
import { extractClientAddress, handleRequest } from "./handler.ts";
import type { HandlerEnv, LedgerDb } from "./handler.ts";
import { createSupabaseLedger } from "./ledger.ts";
import { createAnthropicProvider } from "./providers/anthropic.ts";
import { SERVER_CONFIG } from "./serverConfig.ts";

function readEnv(): HandlerEnv {
  return {
    ANTHROPIC_API_KEY: Deno.env.get("ANTHROPIC_API_KEY"),
    CLIENT_HASH_SALT: Deno.env.get("CLIENT_HASH_SALT"),
    LIVE_MODEL_ENABLED: Deno.env.get("LIVE_MODEL_ENABLED"),
    DAILY_BUDGET_USD: Deno.env.get("DAILY_BUDGET_USD"),
    ALLOWED_ORIGINS: Deno.env.get("ALLOWED_ORIGINS"),
    FUNCTION_MOCK_MODE: Deno.env.get("FUNCTION_MOCK_MODE"),
  };
}

let ledger: LedgerDb | null | undefined;

/** Platform-injected SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY; null when absent (-> ledger_unavailable). */
function getLedger(): LedgerDb | null {
  if (ledger === undefined) {
    const url = Deno.env.get("SUPABASE_URL");
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    ledger = url && key ? createSupabaseLedger(url, key) : null;
  }
  return ledger;
}

Deno.serve((req: Request): Promise<Response> => {
  const env = readEnv();
  const modelId = SERVER_CONFIG.model.model_id;
  const apiKey = env.ANTHROPIC_API_KEY;
  const provider =
    apiKey && modelId
      ? createAnthropicProvider({
          apiKey,
          modelId,
          maxTokens: SERVER_CONFIG.runtime.max_tokens,
          timeoutMs: SERVER_CONFIG.runtime.provider_timeout_ms,
        })
      : null;
  return handleRequest(req, {
    provider,
    db: getLedger(),
    now: () => new Date(),
    env,
    clientAddress: extractClientAddress(req.headers, SERVER_CONFIG.runtime.trusted_address_source),
  });
});

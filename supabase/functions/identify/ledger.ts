// Deno-only: `LedgerDb` over the three security-definer RPCs (PLAN.md 4.7, 4.8) via supabase-js from a pinned esm.sh
// URL. Excluded from tsconfig / eslint / coverage; type-checked by `deno check` (DEFERRED-VALIDATION #2).
// Uses the platform-injected service-role key (server-side only). Any RPC error throws -> handler maps it to
// `ledger_unavailable` and makes no provider call.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { parseFeedbackRpc, parseReserveRpc } from "./handler.ts";
import type { FeedbackArgs, FeedbackRecordStatus, LedgerDb, ReserveArgs, ReserveOutcome, SettleArgs } from "./handler.ts";

export function createSupabaseLedger(url: string, serviceRoleKey: string): LedgerDb {
  const client = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  return {
    async reserve(args: ReserveArgs): Promise<ReserveOutcome> {
      const { data, error } = await client.rpc("reserve_model_call", {
        p_request_id: args.request_id,
        p_request_digest: args.request_digest,
        p_client_hash: args.client_hash,
        p_op: args.op,
        p_provider: args.provider,
        p_model: args.model,
        p_prompt_version: args.prompt_version,
        p_closed_list_hash: args.closed_list_hash,
        p_upload_sha256: args.upload_sha256,
        p_worst_case_usd: args.worst_case_usd,
        p_cap_usd: args.cap_usd,
        p_rate_limit: args.rate_limit,
        p_window_seconds: args.window_seconds,
      });
      if (error) throw new Error(`reserve_model_call failed: ${error.code ?? "unknown"}`);
      return parseReserveRpc(data);
    },

    async settle(args: SettleArgs): Promise<void> {
      const { error } = await client.rpc("settle_model_call", {
        p_request_id: args.request_id,
        p_status: args.status,
        p_input_tokens: args.input_tokens,
        p_output_tokens: args.output_tokens,
        p_cost_usd: args.cost_usd,
        p_price_as_of: args.price_as_of,
        p_latency_ms: args.latency_ms,
        p_error_code: args.error_code,
        p_result: args.result,
      });
      if (error) throw new Error(`settle_model_call failed: ${error.code ?? "unknown"}`);
    },

    async recordFeedback(args: FeedbackArgs): Promise<{ status: FeedbackRecordStatus }> {
      const { data, error } = await client.rpc("record_feedback", {
        p_feedback_id: args.feedback_id,
        p_feedback_digest: args.feedback_digest,
        p_identify_request_id: args.identify_request_id,
        p_kind: args.kind,
        p_upload_sha256: args.upload_sha256,
        p_outcome: args.outcome,
        p_rules_version: args.rules_version,
        p_client_hash: args.client_hash,
        p_rate_key: args.rate_key,
        p_rate_limit: args.rate_limit,
        p_window_seconds: args.window_seconds,
      });
      if (error) throw new Error(`record_feedback failed: ${error.code ?? "unknown"}`);
      return parseFeedbackRpc(data);
    },
  };
}

import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AppConfig } from "./config.ts";

/** Nullable, no auth/session persistence. Constructed only for explicitly configured live mode. */
export function createPublicClient(config: AppConfig): SupabaseClient | null {
  if (config.mode !== "live" || config.setupIssues.length > 0 || config.supabaseUrl === null || config.anonKey === null) return null;
  return createClient(config.supabaseUrl, config.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

export interface EdgeTransport { invoke(body: Readonly<Record<string, unknown>>): Promise<unknown>; }

export function edgeTransport(client: SupabaseClient): EdgeTransport {
  return {
    async invoke(body) {
      const { data, error } = await client.functions.invoke<unknown>("identify", { body });
      if (error !== null) {
        // Supabase returns function 4xx/5xx envelopes through FunctionsHttpError.context.
        // Read that JSON once so rejected vision remains an abstention, not a generic transport error.
        if ("context" in error && error.context instanceof Response) {
          try { const payload: unknown = await error.context.json(); return payload; }
          catch { throw new Error("The identification service could not be reached. Try again or type the item."); }
        }
        throw new Error("The identification service could not be reached. Try again or type the item.");
      }
      return data;
    },
  };
}

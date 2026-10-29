export interface PublicEnvironment {
  readonly VITE_APP_MODE?: string;
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
}
export interface AppConfig {
  readonly mode: "demo" | "live";
  readonly supabaseUrl: string | null;
  readonly anonKey: string | null;
  readonly setupIssues: readonly string[];
}
export function readConfig(env: PublicEnvironment): AppConfig {
  const mode = env.VITE_APP_MODE === "live" ? "live" : "demo";
  const issues: string[] = [];
  if (env.VITE_APP_MODE && !["demo", "live"].includes(env.VITE_APP_MODE)) issues.push("Set VITE_APP_MODE to demo or live.");
  const url = env.VITE_SUPABASE_URL?.trim() || null;
  const key = env.VITE_SUPABASE_ANON_KEY?.trim() || null;
  if (mode === "live") {
    if (url === null) issues.push("Add VITE_SUPABASE_URL.");
    else {
      try { if (new URL(url).protocol !== "https:") issues.push("VITE_SUPABASE_URL must use HTTPS."); }
      catch { issues.push("VITE_SUPABASE_URL must be a valid HTTPS URL."); }
    }
    if (key === null) issues.push("Add VITE_SUPABASE_ANON_KEY (public key only).");
  }
  return { mode, supabaseUrl: url, anonKey: key, setupIssues: issues };
}
export const APP_CONFIG = readConfig(import.meta.env);

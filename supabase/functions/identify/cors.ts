// CORS allowlist (PLAN.md 4.7). Server-only. Exact-origin matching from ALLOWED_ORIGINS (comma-separated); no
// wildcard support: an empty or missing list allows nothing (fail closed). OPTIONS preflight + POST only.

export const ALLOWED_METHODS = "POST, OPTIONS";
export const ALLOWED_HEADERS = "authorization, x-client-info, apikey, content-type";
export const PREFLIGHT_MAX_AGE_SECONDS = "600";

const ORIGIN = /^https?:\/\/[A-Za-z0-9.-]+(:[0-9]{1,5})?$/;

/** Parses ALLOWED_ORIGINS. Entries that are not a bare scheme://host[:port] origin are ignored. */
export function parseAllowedOrigins(raw: string | undefined): readonly string[] {
  if (raw === undefined) return [];
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => ORIGIN.test(entry))
    .map((entry) => entry.toLowerCase());
}

export function isOriginAllowed(origin: string | null, allowed: readonly string[]): origin is string {
  return origin !== null && allowed.includes(origin.toLowerCase());
}

/** Headers for an allowed origin. Callers add these only after `isOriginAllowed`. */
export function corsHeaders(origin: string): Record<string, string> {
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": ALLOWED_METHODS,
    "access-control-allow-headers": ALLOWED_HEADERS,
    "access-control-max-age": PREFLIGHT_MAX_AGE_SECONDS,
    vary: "Origin",
  };
}

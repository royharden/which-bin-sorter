import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Default environment is node (WebCrypto `crypto.subtle` is a Node global). Component tests opt into jsdom with a
// `// @vitest-environment jsdom` docblock at the top of the file.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    coverage: {
      provider: "v8",
      include: ["src/**", "supabase/functions/**"],
      // Deno-only files (Deno globals / URL imports); covered by `deno check` (DEFERRED-VALIDATION #2).
      exclude: ["supabase/functions/identify/index.ts", "supabase/functions/identify/ledger.ts"],
    },
  },
});

// ESLint flat config. Import boundaries use core `no-restricted-imports` patterns per directory (no plugin).
// This is a static source boundary, not a security proof (PLAN.md section 4.5); tests/static/* re-check it with the
// TypeScript compiler API.
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";

const NO_SCRIPTS = {
  group: ["**/scripts", "**/scripts/**"],
  message: "Product code must never import scripts/** (eval and baselines are scripts-only).",
};

// Function files outside the browser allowlist (PLAN.md 4.5). The allowlist is visionSchema.ts, providers/types.ts,
// providers/mock.ts, mockResponses.ts, itemIds.generated.ts, closedList.ts and sha256.ts; everything else in the
// function folder is server-only. tests/static/import-boundaries.test.ts re-checks this over the real import graph.
const SERVER_ONLY_FILES = [
  "**/identify/serverConfig.ts",
  "**/identify/index.ts",
  "**/identify/ledger.ts",
  "**/identify/handler.ts",
  "**/identify/imageHeader.ts",
  "**/identify/digest.ts",
  "**/identify/cors.ts",
  "**/identify/ruleCatalog.ts",
];
// Server-only files that scripts/** may still import (the eval calls the provider transport directly).
const SCRIPT_ALLOWED_SERVER_FILES = ["**/identify/prompt.ts", "**/identify/providers/anthropic.ts"];

const NO_SERVER_ONLY = {
  group: [...SERVER_ONLY_FILES, ...SCRIPT_ALLOWED_SERVER_FILES],
  message: "Browser code may import only the allowlisted function files (PLAN.md section 4.5).",
};

const NO_SERVER_ONLY_FOR_SCRIPTS = {
  group: SERVER_ONLY_FILES,
  message: "scripts/** may import the allowlisted function files plus prompt.ts and providers/anthropic.ts only.",
};

const NO_LEAVING_FUNCTION_FOLDER = ["**/src/**", "**/scripts/**", "**/config/**", "**/rules/**", "**/tests/**"];

export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "coverage/**",
      "node_modules/**",
      "results/**",
      // Deno-only files (Deno globals / URL imports); covered by `deno check` (DEFERRED-VALIDATION #2).
      "supabase/functions/identify/index.ts",
      "supabase/functions/identify/ledger.ts",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: { globals: globals.browser },
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "no-restricted-imports": ["error", { patterns: [NO_SCRIPTS, NO_SERVER_ONLY] }],
    },
  },
  {
    files: ["supabase/functions/identify/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["../*", "../**", ...NO_LEAVING_FUNCTION_FOLDER],
              message: "The function folder imports nothing outside itself.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["supabase/functions/identify/providers/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["../../*", "../../**", ...NO_LEAVING_FUNCTION_FOLDER],
              message: "The function folder imports nothing outside itself.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["scripts/**/*.ts", "tests/**/*.{ts,tsx}", "*.config.{js,ts}"],
    languageOptions: { globals: globals.node },
  },
  {
    files: ["scripts/**/*.ts"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [NO_SERVER_ONLY_FOR_SCRIPTS] }],
    },
  },
);

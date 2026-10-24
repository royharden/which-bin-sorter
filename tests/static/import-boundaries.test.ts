// PLAN 4.5 / M2: source dependency boundaries, using the TypeScript parser. Written, never run in Dirty Mode.
// This is a syntactic source check, not a security proof. Include type imports, re-exports, literal dynamic
// imports and require() so a new indirection cannot quietly bring server code into the browser graph.
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const FUNCTION_ROOT = "supabase/functions/identify/";
const BROWSER_FUNCTIONS = new Set([
  "visionSchema.ts", "providers/types.ts", "providers/mock.ts", "mockResponses.ts",
  "itemIds.generated.ts", "closedList.ts", "sha256.ts",
].map((name) => FUNCTION_ROOT + name));
const SCRIPT_FUNCTIONS = new Set([
  ...BROWSER_FUNCTIONS, FUNCTION_ROOT + "providers/anthropic.ts", FUNCTION_ROOT + "prompt.ts",
]);
const LEDGER_URL = "https://esm.sh/@supabase/supabase-js@2.45.4";

interface Dependency { specifier: string | null }
interface Violation { file: string; rule: string; target: string }
type Sources = ReadonlyMap<string, string>;

function dependencies(file: string, source: string): Dependency[] {
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const found: Dependency[] = [];
  const add = (node: ts.Node | undefined): void => {
    found.push({ specifier: node !== undefined && ts.isStringLiteralLike(node) ? node.text : null });
  };
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      if (node.moduleSpecifier !== undefined) add(node.moduleSpecifier);
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      add(node.moduleReference.expression);
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
      add(node.argument.literal);
    } else if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
      (ts.isIdentifier(node.expression) && node.expression.text === "require"))) {
      add(node.arguments[0]);
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
  return found;
}

function targetOf(from: string, specifier: string, sources: Sources): string {
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(from), specifier));
  return [base, `${base}.ts`, `${base}.tsx`, `${base}.js`, `${base}/index.ts`, `${base}/index.tsx`]
    .find((candidate) => sources.has(candidate)) ?? base;
}

function inspect(sources: Sources, roots: readonly string[] = ["src/main.tsx"]): Violation[] {
  const violations: Violation[] = [];
  const graph = new Map<string, string[]>();
  for (const [file, source] of sources) {
    const product = file.startsWith("src/") || file.startsWith("supabase/");
    const fn = file.startsWith(FUNCTION_ROOT);
    const edges: string[] = [];
    for (const dependency of dependencies(file, source)) {
      const specifier = dependency.specifier;
      if (specifier === null) {
        if (product) violations.push({ file, rule: "computed_import", target: "<computed>" });
        continue;
      }
      if (!specifier.startsWith(".")) {
        if (fn && !(file === FUNCTION_ROOT + "ledger.ts" && specifier === LEDGER_URL)) {
          violations.push({ file, rule: "function_external_dependency", target: specifier });
        }
        if (product && /(^|\/)scripts(\/|$)/.test(specifier)) {
          violations.push({ file, rule: "product_imports_scripts", target: specifier });
        }
        continue;
      }
      const target = targetOf(file, specifier, sources);
      edges.push(target);
      if (product && target.startsWith("scripts/")) violations.push({ file, rule: "product_imports_scripts", target });
      if (fn && !target.startsWith(FUNCTION_ROOT)) violations.push({ file, rule: "function_leaves_folder", target });
      if (file.startsWith("src/") && target.startsWith(FUNCTION_ROOT) && !BROWSER_FUNCTIONS.has(target)) {
        violations.push({ file, rule: "browser_server_import", target });
      }
      if (file.startsWith("scripts/") && target.startsWith(FUNCTION_ROOT) && !SCRIPT_FUNCTIONS.has(target)) {
        violations.push({ file, rule: "script_server_import", target });
      }
      if (file === FUNCTION_ROOT + "closedList.ts" && target !== FUNCTION_ROOT + "sha256.ts") {
        violations.push({ file, rule: "closed_list_dependency", target });
      }
      if (!sources.has(target) && /\.(?:[cm]?[jt]sx?)$/.test(target)) {
        violations.push({ file, rule: "missing_source", target });
      }
    }
    graph.set(file, edges);
  }
  // Walk transitive imports: an allowlisted module may itself import a server-only file.
  const seen = new Set<string>();
  const visit = (file: string): void => {
    if (seen.has(file)) return;
    seen.add(file);
    if (file.startsWith(FUNCTION_ROOT) && !BROWSER_FUNCTIONS.has(file)) {
      violations.push({ file, rule: "browser_reaches_server", target: file });
    }
    for (const child of graph.get(file) ?? []) visit(child);
  };
  for (const root of roots) visit(root);
  return violations;
}

function readSources(): Map<string, string> {
  const sources = new Map<string, string>();
  const walk = (relative: string): void => {
    for (const entry of readdirSync(path.join(ROOT, relative), { withFileTypes: true })) {
      const name = `${relative}/${entry.name}`;
      if (entry.isDirectory()) walk(name);
      else if (/\.(?:[cm]?[jt]sx?)$/.test(name)) sources.set(name, readFileSync(path.join(ROOT, name), "utf8"));
    }
  };
  // Deliberately bounded: never sweep agent work, exports or thinking lanes.
  for (const folder of ["src", "supabase/functions", "scripts"]) walk(folder);
  return sources;
}

describe("static dependency boundaries", () => {
  it("the real product and scripts obey the boundaries; main's browser graph stays allowlisted", () => {
    const sources = readSources();
    expect(sources.has("src/main.tsx")).toBe(true);
    expect(sources.has(FUNCTION_ROOT + "index.ts")).toBe(true);
    // Also walk each src module: M2's normalizer is intentionally not wired into the placeholder App until M3.
    expect(inspect(sources, [...sources.keys()].filter((file) => file.startsWith("src/")))).toEqual([]);
  });

  it("accepts a mock-only browser graph and the pinned ledger URL", () => {
    const sources = new Map([
      ["src/main.tsx", `import { mock } from "../${FUNCTION_ROOT}providers/mock.ts"; void mock;`],
      [FUNCTION_ROOT + "providers/mock.ts", `export { mock } from "../mockResponses.ts";`],
      [FUNCTION_ROOT + "mockResponses.ts", "export const mock = {};"],
      [FUNCTION_ROOT + "ledger.ts", `import { createClient } from "${LEDGER_URL}"; void createClient;`],
    ]);
    expect(inspect(sources)).toEqual([]);
  });

  it.each<[string, string, string, string]>([
    ["direct server import", "src/main.tsx", `import "../${FUNCTION_ROOT}serverConfig.ts";`, "browser_server_import"],
    ["re-export", "src/main.tsx", `export * from "../${FUNCTION_ROOT}providers/anthropic.ts";`, "browser_server_import"],
    ["dynamic script import", "src/main.tsx", `import("../scripts/eval.ts");`, "product_imports_scripts"],
    ["normalized traversal", "src/main.tsx", `import "./../src/../scripts/eval.ts";`, "product_imports_scripts"],
    ["computed import", "src/main.tsx", `import(location.hash);`, "computed_import"],
    ["function escapes", FUNCTION_ROOT + "handler.ts", `import "../../../config/model.json";`, "function_leaves_folder"],
    ["function imports script", FUNCTION_ROOT + "handler.ts", `import "../../../scripts/eval.ts";`, "product_imports_scripts"],
    ["unapproved function package", FUNCTION_ROOT + "handler.ts", `import "some-package";`, "function_external_dependency"],
    ["closed list reaches config", FUNCTION_ROOT + "closedList.ts", `import "./serverConfig.ts";`, "closed_list_dependency"],
    ["scripts import handler", "scripts/eval.ts", `import "../${FUNCTION_ROOT}handler.ts";`, "script_server_import"],
  ])("rejects %s", (_name, file, source, rule) => {
    expect(inspect(new Map([[file, source]])).map((violation) => violation.rule)).toContain(rule);
  });

  it("catches a server file hidden behind an allowlisted mock and a type import", () => {
    const sources = new Map([
      ["src/main.tsx", `import "../${FUNCTION_ROOT}providers/mock.ts";`],
      [FUNCTION_ROOT + "providers/mock.ts", `type Secret = import("../serverConfig.ts").ServerConfig;`],
      [FUNCTION_ROOT + "serverConfig.ts", "export type ServerConfig = {};"],
    ]);
    expect(inspect(sources).map((violation) => violation.rule)).toContain("browser_reaches_server");
  });

  it("scripts may import the provider transport and prompt", () => {
    const sources = new Map([
      ["scripts/eval.ts", `import "../${FUNCTION_ROOT}providers/anthropic.ts"; import "../${FUNCTION_ROOT}prompt.ts";`],
      [FUNCTION_ROOT + "providers/anthropic.ts", "export {};"],
      [FUNCTION_ROOT + "prompt.ts", "export {};"],
    ]);
    expect(inspect(sources)).toEqual([]);
  });
});

// Static "only the resolver selects bins" checker (PLAN.md 4.5), built on the TypeScript compiler API.
// Syntactic only (no type checker): it inspects what the source text says, so it is a static source boundary,
// not a security proof. Used by only-resolver-selects-bins.test.ts on the real tree and on in-memory cases.
import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

export const RESOLVER_FILE = "src/core/resolve.ts";
export const BRAND_TYPE = "ResolvedBin";
export const BRAND_PROPERTY = "__resolved";
export const SELECT_BIN = "selectBin";
const BIN_FIELD_NAMES: ReadonlySet<string> = new Set(["bin", "bin_id"]);

/** Roots scanned in the real tree (repo-relative, posix). */
export const SCANNED_ROOTS = ["src", "supabase/functions"] as const;

export type ViolationRule =
  | "brand_outside_resolver"
  | "brand_cast_outside_selectBin"
  | "selectBin_exported"
  | "bin_field_in_vision_contract"
  | "src_imports_scripts"
  | "default_bin_literal";

export interface Violation {
  file: string;
  line: number;
  rule: ViolationRule;
  detail: string;
}

export interface CheckOptions {
  /** Bin ids from the rules data; string literals equal to one are forbidden in src/core (no default bin). */
  binIds?: readonly string[];
}

export function isVisionContractFile(file: string): boolean {
  return (
    file === "supabase/functions/identify/visionSchema.ts" || file.startsWith("supabase/functions/identify/providers/")
  );
}

function rightmostName(name: ts.EntityName): string {
  return ts.isIdentifier(name) ? name.text : name.right.text;
}

/** True when a type node mentions `name` as a type reference anywhere inside it. */
function mentionsType(node: ts.Node, name: string): boolean {
  if (ts.isTypeReferenceNode(node) && rightmostName(node.typeName) === name) return true;
  return ts.forEachChild(node, (child) => (mentionsType(child, name) ? true : undefined)) ?? false;
}

function propertyNameText(name: ts.PropertyName | ts.BindingName | undefined): string | undefined {
  if (name === undefined) return undefined;
  if (ts.isIdentifier(name) || ts.isPrivateIdentifier(name)) return name.text;
  if (ts.isStringLiteralLike(name) || ts.isNumericLiteral(name)) return name.text;
  if (ts.isComputedPropertyName(name) && ts.isStringLiteralLike(name.expression)) return name.expression.text;
  return undefined;
}

function hasExportModifier(node: ts.Node): boolean {
  if (!ts.canHaveModifiers(node)) return false;
  return (ts.getModifiers(node) ?? []).some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
}

function insideSelectBin(node: ts.Node): boolean {
  for (let current: ts.Node | undefined = node.parent; current !== undefined; current = current.parent) {
    if (ts.isFunctionDeclaration(current) && current.name?.text === SELECT_BIN) return true;
  }
  return false;
}

function resolvesIntoScripts(file: string, specifier: string): boolean {
  if (specifier.startsWith(".")) {
    const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier));
    return target === "scripts" || target.startsWith("scripts/");
  }
  return specifier === "/scripts" || specifier.startsWith("/scripts/");
}

function moduleSpecifierOf(node: ts.Node): string | undefined {
  if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier !== undefined) {
    return ts.isStringLiteral(node.moduleSpecifier) ? node.moduleSpecifier.text : undefined;
  }
  if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
    const first = node.arguments[0];
    return first !== undefined && ts.isStringLiteralLike(first) ? first.text : undefined;
  }
  if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
    const expression = node.moduleReference.expression;
    return ts.isStringLiteral(expression) ? expression.text : undefined;
  }
  return undefined;
}

/** Checks one source file. `file` is repo-relative with forward slashes (e.g. `src/core/resolve.ts`). */
export function checkSource(file: string, text: string, options: CheckOptions = {}): Violation[] {
  const scriptKind = file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, scriptKind);
  const isResolver = file === RESOLVER_FILE;
  const isVisionContract = isVisionContractFile(file);
  const isSrc = file.startsWith("src/");
  const isCore = file.startsWith("src/core/");
  const binIds = new Set(options.binIds ?? []);
  const violations: Violation[] = [];

  const add = (rule: ViolationRule, node: ts.Node, detail: string): void => {
    const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
    violations.push({ file, line, rule, detail });
  };

  const visit = (node: ts.Node): void => {
    // Brand creation: assertions to ResolvedBin (incl. `as unknown as ResolvedBin` and `<ResolvedBin>x`).
    if ((ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) && mentionsType(node.type, BRAND_TYPE)) {
      if (!isResolver) add("brand_outside_resolver", node, `type assertion to ${BRAND_TYPE}`);
      else if (!insideSelectBin(node)) add("brand_cast_outside_selectBin", node, `${BRAND_TYPE} assertion outside ${SELECT_BIN}()`);
    }
    // Brand creation through a type guard or a generic helper.
    if (!isResolver && ts.isTypePredicateNode(node) && node.type !== undefined && mentionsType(node.type, BRAND_TYPE)) {
      add("brand_outside_resolver", node, `type predicate to ${BRAND_TYPE}`);
    }
    if (
      !isResolver &&
      (ts.isCallExpression(node) || ts.isNewExpression(node)) &&
      (node.typeArguments ?? []).some((typeArgument) => mentionsType(typeArgument, BRAND_TYPE))
    ) {
      add("brand_outside_resolver", node, `${BRAND_TYPE} passed as a type argument`);
    }
    // An alternate brand declaration.
    if (!isResolver && (ts.isTypeAliasDeclaration(node) || ts.isInterfaceDeclaration(node)) && node.name.text === BRAND_TYPE) {
      add("brand_outside_resolver", node, `declares its own ${BRAND_TYPE}`);
    }

    // Property names: the brand property outside the resolver, bin fields in the vision contract.
    if (
      ts.isPropertySignature(node) ||
      ts.isPropertyDeclaration(node) ||
      ts.isPropertyAssignment(node) ||
      ts.isShorthandPropertyAssignment(node) ||
      ts.isMethodSignature(node) ||
      ts.isMethodDeclaration(node) ||
      ts.isGetAccessorDeclaration(node) ||
      ts.isSetAccessorDeclaration(node)
    ) {
      const name = propertyNameText(node.name);
      if (name === BRAND_PROPERTY && !isResolver) add("brand_outside_resolver", node, `uses the ${BRAND_PROPERTY} brand property`);
      if (name !== undefined && isVisionContract && BIN_FIELD_NAMES.has(name)) {
        add("bin_field_in_vision_contract", node, `property "${name}" in the vision schema / provider contract`);
      }
    }
    if (
      isVisionContract &&
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isElementAccessExpression(node.left) &&
      ts.isStringLiteralLike(node.left.argumentExpression) &&
      BIN_FIELD_NAMES.has(node.left.argumentExpression.text)
    ) {
      add("bin_field_in_vision_contract", node, `assigns ["${node.left.argumentExpression.text}"]`);
    }

    // selectBin must never be exported, in any form, from any file.
    if (ts.isFunctionDeclaration(node) && node.name?.text === SELECT_BIN && hasExportModifier(node)) {
      add("selectBin_exported", node, "export function selectBin");
    }
    if (
      ts.isVariableStatement(node) &&
      hasExportModifier(node) &&
      node.declarationList.declarations.some((d) => ts.isIdentifier(d.name) && d.name.text === SELECT_BIN)
    ) {
      add("selectBin_exported", node, "export const selectBin");
    }
    if (ts.isExportDeclaration(node) && node.exportClause !== undefined && ts.isNamedExports(node.exportClause)) {
      for (const element of node.exportClause.elements) {
        if (element.name.text === SELECT_BIN || element.propertyName?.text === SELECT_BIN) {
          add("selectBin_exported", element, "export { selectBin }");
        }
      }
    }
    if (ts.isExportAssignment(node) && ts.isIdentifier(node.expression) && node.expression.text === SELECT_BIN) {
      add("selectBin_exported", node, "export default selectBin");
    }

    // Product code never imports scripts/** (eval and bin-naming baselines live there).
    if (isSrc) {
      const specifier = moduleSpecifierOf(node);
      if (specifier !== undefined && resolvesIntoScripts(file, specifier)) {
        add("src_imports_scripts", node, `imports "${specifier}"`);
      }
    }

    // No default bin: a bin id literal in src/core means a bin chosen outside the rules data path.
    if (isCore && binIds.size > 0 && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))) {
      if (binIds.has(node.text)) add("default_bin_literal", node, `bin id literal "${node.text}"`);
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return violations;
}

export interface ResolverShape {
  declaresBrand: boolean;
  declaresSelectBin: boolean;
  brandAssertions: number;
}

/** Structural facts about resolve.ts that the static test asserts directly. */
export function inspectResolver(text: string): ResolverShape {
  const sourceFile = ts.createSourceFile(RESOLVER_FILE, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const shape: ResolverShape = { declaresBrand: false, declaresSelectBin: false, brandAssertions: 0 };
  const visit = (node: ts.Node): void => {
    if (ts.isTypeAliasDeclaration(node) && node.name.text === BRAND_TYPE) {
      shape.declaresBrand = mentionsBrandProperty(node.type);
    }
    if (ts.isFunctionDeclaration(node) && node.name?.text === SELECT_BIN && !hasExportModifier(node)) {
      shape.declaresSelectBin = true;
    }
    if ((ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) && mentionsType(node.type, BRAND_TYPE)) {
      shape.brandAssertions++;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return shape;
}

function mentionsBrandProperty(node: ts.Node): boolean {
  if (ts.isPropertySignature(node) && propertyNameText(node.name) === BRAND_PROPERTY) return true;
  return ts.forEachChild(node, (child) => (mentionsBrandProperty(child) ? true : undefined)) ?? false;
}

/** Repo-relative (posix) .ts/.tsx files under the scanned roots, excluding tests and fixtures. */
export function listSourceFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (relative: string): void => {
    const absolute = path.join(root, relative);
    let names: string[];
    try {
      names = readdirSync(absolute);
    } catch {
      return; // root not created yet (e.g. supabase/functions before M2)
    }
    for (const name of names) {
      const childRelative = `${relative}/${name}`;
      if (statSync(path.join(root, childRelative)).isDirectory()) {
        if (name === "node_modules" || name === "fixtures" || name === "__fixtures__") continue;
        walk(childRelative);
      } else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) {
        out.push(childRelative);
      }
    }
  };
  for (const scanned of SCANNED_ROOTS) walk(scanned);
  return out.sort();
}

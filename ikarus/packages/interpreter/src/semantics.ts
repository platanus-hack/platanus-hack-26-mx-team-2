import type { Expr, NamedArg, Program, Stmt, TypeRef, TypedTool } from "@ikarus/shared";
import type { RawArg, RawExpr, RawProgram, RawStmt } from "./raw-ast.js";
import { semanticError } from "./errors.js";

const TYPE_ALIASES: Readonly<Record<string, TypeRef>> = {
  str: { kind: "str" },
  string: { kind: "str" },
  text: { kind: "str" },
  num: { kind: "num" },
  number: { kind: "num" },
  int: { kind: "num" },
  integer: { kind: "num" },
  float: { kind: "num" },
  bool: { kind: "bool" },
  boolean: { kind: "bool" },
  null: { kind: "null" },
  none: { kind: "null" },
  opaque: { kind: "opaque" },
  dict: { kind: "opaque" },
  object: { kind: "opaque" },
  any: { kind: "opaque" },
  json: { kind: "opaque" },
};

interface CatalogIndex {
  readonly hasTools: boolean;
  readonly byKey: ReadonlyMap<string, TypedTool>;
}

const toolKey = (mcpId: string, tool: string): string => `${mcpId}.${tool}`;

function indexCatalog(catalog: readonly TypedTool[]): CatalogIndex {
  const byKey = new Map<string, TypedTool>();
  for (const t of catalog) byKey.set(toolKey(t.mcpId, t.name), t);
  return { hasTools: catalog.length > 0, byKey };
}

/**
 * Phase 3: lower + validate the raw AST into the checked Program, rejecting
 * everything outside the MVP subset (§6.7). All errors are TRUSTED.
 */
export function check(raw: RawProgram, catalog: readonly TypedTool[] = []): Program {
  const cat = indexCatalog(catalog);
  const scope = new Set<string>();
  const statements: Stmt[] = [];
  let returned = false;

  for (const stmt of raw.statements) {
    if (returned) {
      throw semanticError("no statements are allowed after 'return'", stmt.loc);
    }
    statements.push(lowerStmt(stmt, scope, cat));
    if (stmt.kind === "return") returned = true;
  }

  return { statements };
}

function lowerStmt(stmt: RawStmt, scope: Set<string>, cat: CatalogIndex): Stmt {
  if (stmt.kind === "return") {
    return { kind: "return", value: lowerExpr(stmt.value, scope, cat), loc: stmt.loc };
  }
  const value = lowerExpr(stmt.value, scope, cat);
  scope.add(stmt.name); // bind after evaluating RHS (no self-reference)
  return { kind: "assign", name: stmt.name, value, loc: stmt.loc };
}

function lowerExpr(raw: RawExpr, scope: Set<string>, cat: CatalogIndex): Expr {
  switch (raw.kind) {
    case "str":
      return { kind: "strLit", value: raw.value, loc: raw.loc };
    case "num":
      return { kind: "numLit", value: raw.value, loc: raw.loc };
    case "bool":
      return { kind: "boolLit", value: raw.value, loc: raw.loc };
    case "null":
      return { kind: "nullLit", loc: raw.loc };
    case "list":
      return { kind: "listLit", items: raw.items.map((it) => lowerExpr(it, scope, cat)), loc: raw.loc };
    case "dict":
      return {
        kind: "dictLit",
        entries: raw.entries.map((e) => ({ key: e.key, value: lowerExpr(e.value, scope, cat) })),
        loc: raw.loc,
      };
    case "name":
      if (raw.name === "query_ai") {
        throw semanticError("'query_ai' can only be used as a call, not a value", raw.loc);
      }
      if (!scope.has(raw.name)) {
        throw semanticError(`undefined variable '${raw.name}'`, raw.loc);
      }
      return { kind: "var", name: raw.name, loc: raw.loc };
    case "member":
      return { kind: "member", object: lowerExpr(raw.object, scope, cat), field: raw.field, loc: raw.loc };
    case "index":
      return {
        kind: "index",
        object: lowerExpr(raw.object, scope, cat),
        index: lowerExpr(raw.index, scope, cat),
        loc: raw.loc,
      };
    case "call":
      return lowerCall(raw, scope, cat);
  }
}

function lowerCall(
  raw: Extract<RawExpr, { kind: "call" }>,
  scope: Set<string>,
  cat: CatalogIndex,
): Expr {
  const callee = raw.callee;

  // query_ai(source, "instruction", output_type=T)
  if (callee.kind === "name" && callee.name === "query_ai") {
    return lowerQueryAi(raw, scope, cat);
  }

  // mcpId.tool(arg=value, ...)
  if (callee.kind === "member" && callee.object.kind === "name") {
    return lowerToolCall(raw, callee.object.name, callee.field, scope, cat);
  }

  throw semanticError(
    "invalid call target: only 'mcpId.tool(...)' and 'query_ai(...)' may be called",
    raw.loc,
  );
}

function lowerQueryAi(
  raw: Extract<RawExpr, { kind: "call" }>,
  scope: Set<string>,
  cat: CatalogIndex,
): Expr {
  const positional: RawArg[] = [];
  const keyword = new Map<string, RawArg>();
  for (const arg of raw.args) {
    if (arg.name === undefined) positional.push(arg);
    else {
      if (keyword.has(arg.name)) throw semanticError(`duplicate argument '${arg.name}'`, arg.loc);
      keyword.set(arg.name, arg);
    }
  }

  const sourceArg = keyword.get("source") ?? positional[0];
  const instrArg = keyword.get("instruction") ?? positional[1];
  const typeArg = keyword.get("output_type") ?? keyword.get("output");

  if (!sourceArg) throw semanticError("query_ai requires a 'source' argument", raw.loc);
  if (!instrArg) throw semanticError("query_ai requires an 'instruction' argument", raw.loc);
  if (instrArg.value.kind !== "str") {
    throw semanticError("query_ai 'instruction' must be a string literal", instrArg.loc);
  }
  if (!typeArg) throw semanticError("query_ai requires an 'output_type' argument", raw.loc);

  return {
    kind: "queryAi",
    source: lowerExpr(sourceArg.value, scope, cat),
    instruction: instrArg.value.value,
    outputType: parseTypeRef(typeArg.value),
    loc: raw.loc,
  };
}

function lowerToolCall(
  raw: Extract<RawExpr, { kind: "call" }>,
  mcpId: string,
  tool: string,
  scope: Set<string>,
  cat: CatalogIndex,
): Expr {
  const args: NamedArg[] = [];
  const seen = new Set<string>();
  for (const arg of raw.args) {
    if (arg.name === undefined) {
      throw semanticError(`tool call '${mcpId}.${tool}' requires keyword arguments (name=value)`, arg.loc);
    }
    if (seen.has(arg.name)) throw semanticError(`duplicate argument '${arg.name}'`, arg.loc);
    seen.add(arg.name);
    args.push({ name: arg.name, value: lowerExpr(arg.value, scope, cat) });
  }

  // Catalog validation (only when a catalog is supplied).
  if (cat.hasTools) {
    const def = cat.byKey.get(toolKey(mcpId, tool));
    if (!def) throw semanticError(`unknown tool '${mcpId}.${tool}'`, raw.loc);
    const params = new Set(def.params.map((p) => p.name));
    for (const a of args) {
      if (!params.has(a.name)) {
        throw semanticError(`tool '${mcpId}.${tool}' has no parameter '${a.name}'`, raw.loc);
      }
    }
    for (const p of def.params) {
      if (p.required && !seen.has(p.name)) {
        throw semanticError(`tool '${mcpId}.${tool}' is missing required argument '${p.name}'`, raw.loc);
      }
    }
  }

  return { kind: "toolCall", mcpId, tool, args, loc: raw.loc };
}

/** Interpret an output_type argument as a TypeRef. Unknown/complex → opaque. */
function parseTypeRef(raw: RawExpr): TypeRef {
  if (raw.kind === "name" || raw.kind === "str") {
    const key = (raw.kind === "name" ? raw.name : raw.value).toLowerCase();
    return TYPE_ALIASES[key] ?? { kind: "opaque" };
  }
  // list[T] / array[T]
  if (raw.kind === "index" && raw.object.kind === "name") {
    const base = raw.object.name.toLowerCase();
    if (base === "list" || base === "array") {
      return { kind: "list", of: parseTypeRef(raw.index) };
    }
  }
  throw semanticError("invalid output_type (use e.g. str, num, bool, list[str])", raw.loc);
}

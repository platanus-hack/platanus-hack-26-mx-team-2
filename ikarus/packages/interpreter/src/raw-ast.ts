import type { Loc } from "@ikarus/shared";

/**
 * The PARSER's output: a generic, syntax-only tree. Calls/members/indexes are
 * uniform postfix operators with no notion of "tool" vs "query_ai" — that
 * distinction is made by the semantic phase, which lowers this into the checked
 * `Program` from @ikarus/shared.
 */
export type RawExpr =
  | { kind: "str"; value: string; loc: Loc }
  | { kind: "num"; value: number; loc: Loc }
  | { kind: "bool"; value: boolean; loc: Loc }
  | { kind: "null"; loc: Loc }
  | { kind: "list"; items: RawExpr[]; loc: Loc }
  | { kind: "dict"; entries: RawDictEntry[]; loc: Loc }
  | { kind: "name"; name: string; loc: Loc }
  | { kind: "member"; object: RawExpr; field: string; loc: Loc }
  | { kind: "index"; object: RawExpr; index: RawExpr; loc: Loc }
  | { kind: "call"; callee: RawExpr; args: RawArg[]; loc: Loc };

export interface RawDictEntry {
  key: string;
  value: RawExpr;
}

export interface RawArg {
  /** Present for keyword args (`name=expr`); undefined for positional. */
  name?: string;
  value: RawExpr;
  loc: Loc;
}

export type RawStmt =
  | { kind: "assign"; name: string; value: RawExpr; loc: Loc }
  | { kind: "return"; value: RawExpr; loc: Loc };

export interface RawProgram {
  statements: RawStmt[];
}

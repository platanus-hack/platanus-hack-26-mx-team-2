/**
 * The CHECKED AST of the Ikarus Plan Language (LPL).
 *
 * This is the canonical, post-semantic-analysis program shape: the parser's raw
 * tree (internal to @ikarus/interpreter) is lowered into this restricted set by
 * the semantic phase, which rejects anything outside the MVP subset (§6.7).
 *
 * Grammar & semantics: see packages/interpreter/GRAMMAR.md
 */
import type { TypeRef } from "./type-ref.js";

export interface Loc {
  readonly line: number;
  readonly col: number;
}

/** Literal payloads. Nested literals (lists/dicts) hold Exprs, not raw values. */
export type Expr =
  | { readonly kind: "strLit"; readonly value: string; readonly loc: Loc }
  | { readonly kind: "numLit"; readonly value: number; readonly loc: Loc }
  | { readonly kind: "boolLit"; readonly value: boolean; readonly loc: Loc }
  | { readonly kind: "nullLit"; readonly loc: Loc }
  | { readonly kind: "listLit"; readonly items: readonly Expr[]; readonly loc: Loc }
  | { readonly kind: "dictLit"; readonly entries: readonly DictEntry[]; readonly loc: Loc }
  | { readonly kind: "var"; readonly name: string; readonly loc: Loc }
  | { readonly kind: "member"; readonly object: Expr; readonly field: string; readonly loc: Loc }
  | { readonly kind: "index"; readonly object: Expr; readonly index: Expr; readonly loc: Loc }
  | {
      readonly kind: "toolCall";
      readonly mcpId: string;
      readonly tool: string;
      readonly args: readonly NamedArg[];
      readonly loc: Loc;
    }
  | {
      readonly kind: "queryAi";
      readonly source: Expr;
      readonly instruction: string;
      readonly outputType: TypeRef;
      readonly loc: Loc;
    };

export interface DictEntry {
  readonly key: string;
  readonly value: Expr;
}

export interface NamedArg {
  readonly name: string;
  readonly value: Expr;
}

export type Stmt =
  | { readonly kind: "assign"; readonly name: string; readonly value: Expr; readonly loc: Loc }
  | { readonly kind: "return"; readonly value: Expr; readonly loc: Loc };

export interface Program {
  readonly statements: readonly Stmt[];
}

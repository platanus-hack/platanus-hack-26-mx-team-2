import type { Loc } from "@ikarus/shared";

export type TokenType =
  | "ident"
  | "string"
  | "number"
  | "keyword" // return | true | false | null
  | "eq" // =
  | "dot" // .
  | "comma" // ,
  | "colon" // :
  | "lparen"
  | "rparen"
  | "lbracket"
  | "rbracket"
  | "lbrace"
  | "rbrace"
  | "newline"
  | "eof";

export const KEYWORDS = new Set(["return", "true", "false", "null"]);

export interface Token {
  readonly type: TokenType;
  /** Raw lexeme (for ident/keyword/punct) or decoded value (string/number). */
  readonly value: string;
  /** Decoded numeric value, only for `number` tokens. */
  readonly num?: number;
  readonly loc: Loc;
}

import type { Loc } from "@ikarus/shared";
import { KEYWORDS, type Token, type TokenType } from "./tokens.js";
import { lexError } from "./errors.js";

const isDigit = (c: string): boolean => c >= "0" && c <= "9";
const isIdentStart = (c: string): boolean =>
  (c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || c === "_";
const isIdentPart = (c: string): boolean => isIdentStart(c) || isDigit(c);

const PUNCT: Readonly<Record<string, TokenType>> = {
  "=": "eq",
  ".": "dot",
  ",": "comma",
  ":": "colon",
  "(": "lparen",
  ")": "rparen",
  "[": "lbracket",
  "]": "rbracket",
  "{": "lbrace",
  "}": "rbrace",
};

const ESCAPES: Readonly<Record<string, string>> = {
  '"': '"',
  "'": "'",
  "\\": "\\",
  n: "\n",
  t: "\t",
  r: "\r",
};

/**
 * Phase 1: source → token stream. Knows nothing of grammar.
 *
 * Newlines are emitted as tokens (they terminate statements) EXCEPT while a
 * bracket/paren/brace is open, so multi-line calls are allowed.
 */
export function lex(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  let line = 1;
  let col = 1;
  let bracketDepth = 0;

  const here = (): Loc => ({ line, col });

  const advance = (): string => {
    const c = source[i++]!;
    if (c === "\n") {
      line++;
      col = 1;
    } else {
      col++;
    }
    return c;
  };

  const push = (type: TokenType, value: string, loc: Loc, num?: number): void => {
    tokens.push(num === undefined ? { type, value, loc } : { type, value, loc, num });
  };

  while (i < source.length) {
    const c = source[i]!;

    // whitespace (not newline)
    if (c === " " || c === "\t") {
      advance();
      continue;
    }

    // comments
    if (c === "#") {
      while (i < source.length && source[i] !== "\n") advance();
      continue;
    }

    // newlines (suppressed inside brackets)
    if (c === "\n" || c === "\r") {
      const loc = here();
      if (c === "\r" && source[i + 1] === "\n") advance();
      advance();
      if (bracketDepth === 0) push("newline", "\\n", loc);
      continue;
    }

    // strings
    if (c === '"' || c === "'") {
      const loc = here();
      const quote = advance();
      let value = "";
      while (true) {
        if (i >= source.length) throw lexError("unterminated string", loc);
        const ch = advance();
        if (ch === quote) break;
        if (ch === "\n") throw lexError("newline in string literal", loc);
        if (ch === "\\") {
          if (i >= source.length) throw lexError("unterminated escape", here());
          const esc = advance();
          const decoded = ESCAPES[esc];
          if (decoded === undefined) throw lexError(`invalid escape \\${esc}`, here());
          value += decoded;
        } else {
          value += ch;
        }
      }
      push("string", value, loc);
      continue;
    }

    // numbers (leading '-' only when followed by a digit)
    if (isDigit(c) || (c === "-" && isDigit(source[i + 1] ?? ""))) {
      const loc = here();
      let raw = advance(); // digit or '-'
      while (i < source.length && isDigit(source[i]!)) raw += advance();
      if (source[i] === "." && isDigit(source[i + 1] ?? "")) {
        raw += advance(); // '.'
        while (i < source.length && isDigit(source[i]!)) raw += advance();
      }
      push("number", raw, loc, Number(raw));
      continue;
    }

    // identifiers / keywords
    if (isIdentStart(c)) {
      const loc = here();
      let name = advance();
      while (i < source.length && isIdentPart(source[i]!)) name += advance();
      push(KEYWORDS.has(name) ? "keyword" : "ident", name, loc);
      continue;
    }

    // punctuation
    const punct = PUNCT[c];
    if (punct) {
      const loc = here();
      advance();
      if (c === "(" || c === "[" || c === "{") bracketDepth++;
      if (c === ")" || c === "]" || c === "}") bracketDepth = Math.max(0, bracketDepth - 1);
      push(punct, c, loc);
      continue;
    }

    throw lexError(`unexpected character '${c}'`, here());
  }

  push("eof", "", here());
  return tokens;
}

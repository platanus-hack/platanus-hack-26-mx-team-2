import type { Loc } from "@ikarus/shared";
import type { Token, TokenType } from "./tokens.js";
import type { RawArg, RawDictEntry, RawExpr, RawProgram, RawStmt } from "./raw-ast.js";
import { lex } from "./lexer.js";
import { parseError } from "./errors.js";

/**
 * Phase 2: tokens → raw AST. A hand-written recursive-descent parser. Pure
 * syntax — it accepts a superset of valid programs and never executes anything.
 */
class Parser {
  private pos = 0;
  constructor(private readonly tokens: Token[]) {}

  private peek(offset = 0): Token {
    return this.tokens[Math.min(this.pos + offset, this.tokens.length - 1)]!;
  }
  private at(type: TokenType): boolean {
    return this.peek().type === type;
  }
  private next(): Token {
    return this.tokens[this.pos++]!;
  }
  private expect(type: TokenType, what: string): Token {
    const tok = this.peek();
    if (tok.type !== type) {
      throw parseError(`expected ${what}, got '${tok.value || tok.type}'`, tok.loc);
    }
    return this.next();
  }
  private skipNewlines(): void {
    while (this.at("newline")) this.next();
  }

  parseProgram(): RawProgram {
    const statements: RawStmt[] = [];
    this.skipNewlines();
    while (!this.at("eof")) {
      statements.push(this.parseStatement());
      if (this.at("eof")) break;
      // statements must be separated by at least one newline
      if (!this.at("newline")) {
        const tok = this.peek();
        throw parseError(`expected end of line, got '${tok.value || tok.type}'`, tok.loc);
      }
      this.skipNewlines();
    }
    return { statements };
  }

  private parseStatement(): RawStmt {
    const tok = this.peek();
    if (tok.type === "keyword" && tok.value === "return") {
      this.next();
      const value = this.parseExpr();
      return { kind: "return", value, loc: tok.loc };
    }
    // assignment: IDENT '=' expr
    if (tok.type === "ident" && this.peek(1).type === "eq") {
      const name = this.next().value;
      this.expect("eq", "'='");
      const value = this.parseExpr();
      return { kind: "assign", name, value, loc: tok.loc };
    }
    throw parseError(
      `expected a statement (assignment 'x = ...' or 'return ...'), got '${tok.value || tok.type}'`,
      tok.loc,
    );
  }

  private parseExpr(): RawExpr {
    return this.parsePostfix();
  }

  private parsePostfix(): RawExpr {
    let expr = this.parsePrimary();
    while (true) {
      const tok = this.peek();
      if (tok.type === "dot") {
        this.next();
        const field = this.expect("ident", "a field name after '.'");
        expr = { kind: "member", object: expr, field: field.value, loc: tok.loc };
      } else if (tok.type === "lbracket") {
        this.next();
        const index = this.parseExpr();
        this.expect("rbracket", "']'");
        expr = { kind: "index", object: expr, index, loc: tok.loc };
      } else if (tok.type === "lparen") {
        this.next();
        const args = this.parseArgList();
        this.expect("rparen", "')'");
        expr = { kind: "call", callee: expr, args, loc: tok.loc };
      } else {
        return expr;
      }
    }
  }

  private parseArgList(): RawArg[] {
    const args: RawArg[] = [];
    if (this.at("rparen")) return args;
    while (true) {
      args.push(this.parseArg());
      if (this.at("comma")) {
        this.next();
        if (this.at("rparen")) break; // trailing comma
        continue;
      }
      break;
    }
    return args;
  }

  private parseArg(): RawArg {
    const tok = this.peek();
    // keyword arg: IDENT '=' expr
    if (tok.type === "ident" && this.peek(1).type === "eq") {
      this.next();
      this.expect("eq", "'='");
      const value = this.parseExpr();
      return { name: tok.value, value, loc: tok.loc };
    }
    const value = this.parseExpr();
    return { value, loc: tok.loc };
  }

  private parsePrimary(): RawExpr {
    const tok = this.peek();
    switch (tok.type) {
      case "string":
        this.next();
        return { kind: "str", value: tok.value, loc: tok.loc };
      case "number":
        this.next();
        return { kind: "num", value: tok.num ?? Number(tok.value), loc: tok.loc };
      case "keyword":
        this.next();
        if (tok.value === "true") return { kind: "bool", value: true, loc: tok.loc };
        if (tok.value === "false") return { kind: "bool", value: false, loc: tok.loc };
        if (tok.value === "null") return { kind: "null", loc: tok.loc };
        throw parseError(`unexpected keyword '${tok.value}'`, tok.loc);
      case "ident":
        this.next();
        return { kind: "name", name: tok.value, loc: tok.loc };
      case "lbracket":
        return this.parseList();
      case "lbrace":
        return this.parseDict();
      case "lparen": {
        this.next();
        const inner = this.parseExpr();
        this.expect("rparen", "')'");
        return inner;
      }
      default:
        throw parseError(`unexpected '${tok.value || tok.type}'`, tok.loc);
    }
  }

  private parseList(): RawExpr {
    const loc: Loc = this.expect("lbracket", "'['").loc;
    const items: RawExpr[] = [];
    if (!this.at("rbracket")) {
      while (true) {
        items.push(this.parseExpr());
        if (this.at("comma")) {
          this.next();
          if (this.at("rbracket")) break;
          continue;
        }
        break;
      }
    }
    this.expect("rbracket", "']'");
    return { kind: "list", items, loc };
  }

  private parseDict(): RawExpr {
    const loc: Loc = this.expect("lbrace", "'{'").loc;
    const entries: RawDictEntry[] = [];
    if (!this.at("rbrace")) {
      while (true) {
        const keyTok = this.peek();
        let key: string;
        if (keyTok.type === "string" || keyTok.type === "ident") {
          key = this.next().value;
        } else {
          throw parseError(`expected dict key (string or identifier), got '${keyTok.value || keyTok.type}'`, keyTok.loc);
        }
        this.expect("colon", "':'");
        const value = this.parseExpr();
        entries.push({ key, value });
        if (this.at("comma")) {
          this.next();
          if (this.at("rbrace")) break;
          continue;
        }
        break;
      }
    }
    this.expect("rbrace", "'}'");
    return { kind: "dict", entries, loc };
  }
}

export function parse(source: string): RawProgram {
  return new Parser(lex(source)).parseProgram();
}

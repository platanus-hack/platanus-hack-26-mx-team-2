import { describe, expect, it } from "vitest";
import { LplError, compile, lex, parse } from "../src/index.js";
import { DEMO_CATALOG } from "./fakes.js";

describe("lexer", () => {
  it("tokenizes the demo program", () => {
    const toks = lex(`emails = gmail.list_recent(n=10)\nreturn emails`);
    expect(toks.map((t) => t.type)).toContain("newline");
    expect(toks.at(-1)!.type).toBe("eof");
  });

  it("suppresses newlines inside brackets", () => {
    const toks = lex(`x = foo(\n  a=1,\n  b=2\n)`);
    // only the structural tokens, no newline inside the call
    expect(toks.filter((t) => t.type === "newline")).toHaveLength(0);
  });

  it("rejects unterminated strings", () => {
    expect(() => lex(`x = "abc`)).toThrow(LplError);
  });
});

describe("parser", () => {
  it("parses calls, members and indexes uniformly", () => {
    const prog = parse(`x = a.b(c=1)[0].d`);
    expect(prog.statements).toHaveLength(1);
  });

  it("rejects a bare expression statement", () => {
    expect(() => parse(`gmail.list_recent()`)).toThrow(LplError);
  });
});

describe("semantics", () => {
  it("accepts the canonical demo program", () => {
    const prog = compile(
      `emails = gmail.list_recent(n=10)\nresumen = query_ai(emails, "resume", output_type=str)\nreturn resumen`,
      DEMO_CATALOG,
    );
    expect(prog.statements).toHaveLength(3);
    const last = prog.statements.at(-1)!;
    expect(last.kind).toBe("return");
  });

  it("lowers query_ai with positional source + instruction + list[str] output", () => {
    const prog = compile(`x = 1\nr = query_ai(x, "do", output_type=list[str])\nreturn r`, []);
    const assign = prog.statements[1];
    expect(assign?.kind).toBe("assign");
    if (assign?.kind === "assign") {
      expect(assign.value.kind).toBe("queryAi");
      if (assign.value.kind === "queryAi") {
        expect(assign.value.outputType).toEqual({ kind: "list", of: { kind: "str" } });
      }
    }
  });

  it("rejects undefined variables", () => {
    expect(() => compile(`return missing`, [])).toThrow(/undefined variable/);
  });

  it("rejects statements after return", () => {
    expect(() => compile(`return 1\nx = 2`, [])).toThrow(/after 'return'/);
  });

  it("rejects an invalid call target", () => {
    expect(() => compile(`x = foo()\nreturn x`, [])).toThrow(/invalid call target/);
  });

  it("requires keyword args for tool calls", () => {
    expect(() => compile(`x = gmail.list_recent(10)\nreturn x`, DEMO_CATALOG)).toThrow(/keyword/);
  });

  it("rejects unknown tools when a catalog is present", () => {
    expect(() => compile(`x = gmail.nope()\nreturn x`, DEMO_CATALOG)).toThrow(/unknown tool/);
  });

  it("rejects missing required args", () => {
    expect(() => compile(`x = mailer.send_email(to="a@b.com")\nreturn x`, DEMO_CATALOG)).toThrow(
      /missing required argument 'body'/,
    );
  });

  it("requires query_ai instruction to be a string literal", () => {
    expect(() => compile(`y = "hi"\nx = query_ai(y, y, output_type=str)\nreturn x`, [])).toThrow(
      /must be a string literal/,
    );
  });
});

import { describe, expect, it } from "vitest";
import type { InterpreterDeps } from "@ikarus/shared";
import { SOURCE_USER, mcpSource } from "@ikarus/shared";
import { LplError, compile, createInterpreter, lex, parse } from "../src/index.js";
import { DEMO_CATALOG, DefaultSecurePolicy, FakeQuarantine, FakeTools } from "./fakes.js";

function deps(): { deps: InterpreterDeps; tools: FakeTools } {
  const tools = new FakeTools(DEMO_CATALOG);
  const d: InterpreterDeps = {
    tools,
    quarantine: new FakeQuarantine(() => "summary"),
    policy: new DefaultSecurePolicy(),
  };
  return { deps: d, tools };
}

function phaseOf(fn: () => void): string {
  try {
    fn();
  } catch (e) {
    if (e instanceof LplError) return e.phase;
    throw e;
  }
  throw new Error("expected an LplError");
}

describe("error phases are distinguishable (for the Planner repair loop)", () => {
  it("tags lex / parse / semantic errors", () => {
    expect(phaseOf(() => lex(`x = "abc`))).toBe("lex");
    expect(phaseOf(() => parse(`gmail.list_recent()`))).toBe("parse");
    expect(phaseOf(() => compile(`return missing`, []))).toBe("semantic");
  });
});

describe("lexer details", () => {
  it("decodes escapes and single quotes", () => {
    const toks = lex(`x = 'a\\nb'`);
    expect(toks.find((t) => t.type === "string")!.value).toBe("a\nb");
  });
  it("lexes negative and float numbers", () => {
    expect(lex(`x = -3`).find((t) => t.type === "number")!.num).toBe(-3);
    expect(lex(`x = 2.5`).find((t) => t.type === "number")!.num).toBe(2.5);
  });
  it("skips comments", () => {
    const toks = lex(`x = 1 # this is ignored\nreturn x`);
    expect(toks.some((t) => t.value.includes("ignored"))).toBe(false);
  });
});

describe("parser details", () => {
  it("parses lists, dicts, trailing commas and parens", () => {
    expect(() => parse(`x = [1, 2, 3,]`)).not.toThrow();
    expect(() => parse(`x = {a: 1, "b": 2,}`)).not.toThrow();
    expect(() => parse(`x = (1)`)).not.toThrow();
  });
});

describe("semantics details", () => {
  it("lowers nested list types", () => {
    const prog = compile(`x=1\nr = query_ai(x, "d", output_type=list[list[str]])\nreturn r`, []);
    const a = prog.statements[1];
    expect(a?.kind === "assign" && a.value.kind === "queryAi" && a.value.outputType).toEqual({
      kind: "list",
      of: { kind: "list", of: { kind: "str" } },
    });
  });
  it("degrades unknown output types to opaque", () => {
    const prog = compile(`x=1\nr = query_ai(x, "d", output_type=Email)\nreturn r`, []);
    const a = prog.statements[1];
    expect(a?.kind === "assign" && a.value.kind === "queryAi" && a.value.outputType).toEqual({
      kind: "opaque",
    });
  });
  it("accepts query_ai in full keyword form", () => {
    expect(() =>
      compile(`x=1\nr = query_ai(source=x, instruction="d", output_type=str)\nreturn r`, []),
    ).not.toThrow();
  });
  it("rejects duplicate arguments", () => {
    expect(() => compile(`x = mailer.send_email(to="a", to="b", body="c")\nreturn x`, DEMO_CATALOG)).toThrow(
      /duplicate argument/,
    );
  });
  it("allows reassignment of a variable", () => {
    expect(() => compile(`x = 1\nx = 2\nreturn x`, [])).not.toThrow();
  });
});

describe("capability propagation through containers (evaluator, not just joinCaps)", () => {
  it("a list mixing trusted + untrusted into a sink is blocked", async () => {
    const { deps: d, tools } = deps();
    const program = [
      `emails = gmail.list_recent(n=10)`,
      `recips = ["ok@corp.com", emails[0].sender]`,
      `sent = mailer.send_email(to=recips, body="hi")`,
      `return sent`,
    ].join("\n");
    const result = await createInterpreter().run(program, d);
    expect(result.status).toBe("blocked");
    expect(tools.sentEmails).toHaveLength(0);
  });

  it("a dict whose value is untrusted taints the sink arg", async () => {
    const { deps: d, tools } = deps();
    const program = [
      `emails = gmail.list_recent(n=10)`,
      `payload = {to: "ok@corp.com", note: emails[0].body}`,
      `sent = mailer.send_email(to="ok@corp.com", body=payload)`,
      `return sent`,
    ].join("\n");
    const result = await createInterpreter().run(program, d);
    expect(result.status).toBe("blocked");
    expect(tools.sentEmails).toHaveLength(0);
  });

  it("a list of only trusted literals into a sink is allowed", async () => {
    const { deps: d, tools } = deps();
    const result = await createInterpreter().run(
      `sent = mailer.send_email(to=["a@corp.com", "b@corp.com"], body="hi")\nreturn sent`,
      d,
    );
    expect(result.status).toBe("completed");
    expect(tools.sentEmails).toHaveLength(1);
  });
});

describe("return-value capability (§7.5 labeling)", () => {
  it("surfaces an untrusted return so the gateway can label it", async () => {
    const { deps: d } = deps();
    const result = await createInterpreter().run(
      `emails = gmail.list_recent(n=10)\nreturn emails`,
      d,
    );
    expect(result.status).toBe("completed");
    expect(result.resultCap?.trusted).toBe(false);
    expect(result.resultCap?.provenance).toContain(mcpSource("gmail"));
  });

  it("marks a trusted-literal return as trusted", async () => {
    const { deps: d } = deps();
    const result = await createInterpreter().run(`return "done"`, d);
    expect(result.resultCap?.trusted).toBe(true);
    expect(result.resultCap?.provenance).toEqual([SOURCE_USER]);
  });
});

describe("degenerate programs", () => {
  it("a program with no return completes with a null result", async () => {
    const { deps: d } = deps();
    const result = await createInterpreter().run(`x = 1`, d);
    expect(result.status).toBe("completed");
    expect(result.result).toBeNull();
  });

  it("an empty program completes with a null result", async () => {
    const { deps: d } = deps();
    const result = await createInterpreter().run(``, d);
    expect(result.status).toBe("completed");
    expect(result.result).toBeNull();
  });
});

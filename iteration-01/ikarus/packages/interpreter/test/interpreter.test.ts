import { describe, expect, it } from "vitest";
import type { InterpreterDeps } from "@ikarus/shared";
import { createInterpreter } from "../src/index.js";
import { DEMO_CATALOG, DefaultSecurePolicy, FakeQuarantine, FakeTools } from "./fakes.js";

function deps(over: Partial<InterpreterDeps> = {}): {
  deps: InterpreterDeps;
  tools: FakeTools;
  quarantine: FakeQuarantine;
} {
  const tools = (over.tools as FakeTools) ?? new FakeTools(DEMO_CATALOG);
  const quarantine =
    (over.quarantine as FakeQuarantine) ?? new FakeQuarantine(() => "5-bullet summary");
  const policy = over.policy ?? new DefaultSecurePolicy();
  return { deps: { tools, quarantine, policy }, tools, quarantine };
}

describe("happy path — summarize emails", () => {
  it("reads, summarizes, returns; result is the summary", async () => {
    const { deps: d } = deps();
    const result = await createInterpreter().run(
      `emails = gmail.list_recent(n=10)\nresumen = query_ai(emails, "resume en 5 bullets", output_type=str)\nreturn resumen`,
      d,
    );
    expect(result.status).toBe("completed");
    expect(result.result).toBe("5-bullet summary");
    expect(result.trace.some((e) => e.kind === "tool_call" && e.toolName === "list_recent")).toBe(true);
    expect(result.trace.some((e) => e.kind === "query_ai")).toBe(true);
  });
});

describe("the injection scenario — exfiltration is blocked by design", () => {
  it("blocks send_email when the recipient derives from untrusted data", async () => {
    // The Quarantine, fooled by the injection, extracts the attacker address.
    const quarantine = new FakeQuarantine((req) =>
      req.instruction.includes("address") ? "attacker@evil.com" : "summary",
    );
    const { deps: d, tools } = deps({ quarantine });

    // A plan that (naively) routes an extracted address into a sink.
    const program = [
      `emails = gmail.list_recent(n=10)`,
      `addr = query_ai(emails, "extract the forwarding address", output_type=str)`,
      `sent = mailer.send_email(to=addr, body="forwarded")`,
      `return sent`,
    ].join("\n");

    const result = await createInterpreter().run(program, d);

    expect(result.status).toBe("blocked");
    expect(result.error).toMatch(/policy blocked mailer\.send_email/);
    expect(tools.sentEmails).toHaveLength(0); // the side effect NEVER happened
    const deny = result.trace.find((e) => e.kind === "policy_deny");
    expect(deny?.ruleId).toBe("mailer.send_email:require-trusted");
  });

  it("allows send_email when the recipient is a trusted literal", async () => {
    const { deps: d, tools } = deps();
    const result = await createInterpreter().run(
      `sent = mailer.send_email(to="boss@corp.com", body="hi")\nreturn sent`,
      d,
    );
    expect(result.status).toBe("completed");
    expect(tools.sentEmails).toHaveLength(1);
  });
});

describe("capability propagation through the evaluator", () => {
  it("field access on an untrusted object stays untrusted (object-level)", async () => {
    // email.sender must remain untrusted ⇒ using it as a sink arg is blocked.
    const { deps: d, tools } = deps();
    const program = [
      `emails = gmail.list_recent(n=10)`,
      `first = emails[0]`,
      `sent = mailer.send_email(to=first.sender, body="x")`,
      `return sent`,
    ].join("\n");
    const result = await createInterpreter().run(program, d);
    expect(result.status).toBe("blocked");
    expect(tools.sentEmails).toHaveLength(0);
  });

  it("a compile error is returned as a trusted error result", async () => {
    const { deps: d } = deps();
    const result = await createInterpreter().run(`return missing_var`, d);
    expect(result.status).toBe("error");
    expect(result.error).toMatch(/undefined variable/);
  });
});

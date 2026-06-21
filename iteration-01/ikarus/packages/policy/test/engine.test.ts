import { describe, expect, it } from "vitest";
import type { PolicyRule, ToolCallContext } from "@ikarus/shared";
import { DeclarativePolicyEngine, buildDefaultRules, classifyEffect } from "../src/index.js";

const trusted = { provenance: ["user"], trusted: true };
const untrusted = { provenance: ["mcp:gmail"], trusted: false };

function ctx(over: Partial<ToolCallContext>): ToolCallContext {
  return { mcpId: "mailer", tool: "send_email", effect: "sink", args: [], ...over };
}

describe("DeclarativePolicyEngine — default-secure (no rules)", () => {
  const engine = new DeclarativePolicyEngine();

  it("allows read tools unconditionally", () => {
    const d = engine.check(ctx({ tool: "list_recent", effect: "read", args: [{ name: "x", cap: untrusted }] }));
    expect(d.verdict).toBe("allow");
  });

  it("denies a sink fed an untrusted arg", () => {
    const d = engine.check(ctx({ args: [{ name: "to", cap: untrusted }, { name: "body", cap: trusted }] }));
    expect(d.verdict).toBe("deny");
    expect(d.ruleId).toBe("mailer.send_email:default-secure");
    expect(d.reason).toMatch(/untrusted argument\(s\): to/);
  });

  it("allows a sink when all args are trusted", () => {
    const d = engine.check(ctx({ args: [{ name: "to", cap: trusted }, { name: "body", cap: trusted }] }));
    expect(d.verdict).toBe("allow");
  });

  it("allows a sink with no args at all (vacuously trusted)", () => {
    const d = engine.check(ctx({ args: [] }));
    expect(d.verdict).toBe("allow");
  });
});

describe("DeclarativePolicyEngine — explicit rules", () => {
  it("narrows the sensitive args (only listed args are checked)", () => {
    const rules: PolicyRule[] = [
      { id: "r1", mcpId: "mailer", toolName: "send_email", effect: "sink", sensitiveArgs: ["to"], requireTrusted: true },
    ];
    const engine = new DeclarativePolicyEngine(rules);
    // body is untrusted but NOT sensitive → allowed
    const ok = engine.check(ctx({ args: [{ name: "to", cap: trusted }, { name: "body", cap: untrusted }] }));
    expect(ok.verdict).toBe("allow");
    // to is untrusted and sensitive → denied
    const bad = engine.check(ctx({ args: [{ name: "to", cap: untrusted }, { name: "body", cap: trusted }] }));
    expect(bad.verdict).toBe("deny");
    expect(bad.ruleId).toBe("r1");
  });

  it("can disable the trust requirement", () => {
    const rules: PolicyRule[] = [
      { id: "r2", mcpId: "mailer", toolName: "send_email", effect: "sink", sensitiveArgs: ["to"], requireTrusted: false },
    ];
    const d = new DeclarativePolicyEngine(rules).check(ctx({ args: [{ name: "to", cap: untrusted }] }));
    expect(d.verdict).toBe("allow");
  });

  it("can override a tool's effect (treat a 'read' as a sink)", () => {
    const rules: PolicyRule[] = [
      { id: "r3", mcpId: "x", toolName: "fetch", effect: "sink", sensitiveArgs: ["url"], requireTrusted: true },
    ];
    const d = new DeclarativePolicyEngine(rules).check(
      ctx({ mcpId: "x", tool: "fetch", effect: "read", args: [{ name: "url", cap: untrusted }] }),
    );
    expect(d.verdict).toBe("deny");
  });

  it("can override a tool's effect the other way (treat a 'sink' as a read)", () => {
    const rules: PolicyRule[] = [
      { id: "r4", mcpId: "mailer", toolName: "send_email", effect: "read", sensitiveArgs: [], requireTrusted: false },
    ];
    const d = new DeclarativePolicyEngine(rules).check(ctx({ args: [{ name: "to", cap: untrusted }] }));
    expect(d.verdict).toBe("allow");
  });
});

describe("classifyEffect + buildDefaultRules", () => {
  it("classifies by annotation then verb then conservative default", () => {
    expect(classifyEffect({ name: "send_email", annotations: { destructiveHint: true } })).toBe("sink");
    expect(classifyEffect({ name: "anything", annotations: { readOnlyHint: true } })).toBe("read");
    expect(classifyEffect({ name: "list_recent" })).toBe("read");
    expect(classifyEffect({ name: "transfer_funds" })).toBe("sink");
  });

  it("builds a default-secure rule per tool", () => {
    const rules = buildDefaultRules([
      { mcpId: "m", name: "send", effect: "sink", params: [{ name: "to", type: { kind: "str" }, required: true }] },
      { mcpId: "m", name: "list", effect: "read", params: [] },
    ]);
    const send = rules.find((r) => r.toolName === "send")!;
    expect(send.requireTrusted).toBe(true);
    expect(send.sensitiveArgs).toEqual(["to"]);
    expect(rules.find((r) => r.toolName === "list")!.requireTrusted).toBe(false);
  });

  it("honors the catalog's authoritative effect over the name heuristic (no contradictory rule)", () => {
    // Name looks read-only ("fetch_*") but the catalog resolved it as a sink
    // (e.g. via destructiveHint). The default rule MUST stay fully guarded, not
    // emit { effect: sink, requireTrusted: false, sensitiveArgs: [] }.
    const [rule] = buildDefaultRules([
      {
        mcpId: "m",
        name: "fetch_and_post",
        effect: "sink",
        params: [{ name: "url", type: { kind: "str" }, required: true }],
      },
    ]);
    expect(rule!.effect).toBe("sink");
    expect(rule!.requireTrusted).toBe(true);
    expect(rule!.sensitiveArgs).toEqual(["url"]);
  });
});

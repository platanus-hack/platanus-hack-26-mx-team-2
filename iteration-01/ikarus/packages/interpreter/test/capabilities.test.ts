import { describe, expect, it } from "vitest";
import { SOURCE_QUARANTINE, SOURCE_USER, mcpSource } from "@ikarus/shared";
import { joinCaps, quarantineCap, toolResultCap, userTrusted } from "../src/index.js";

describe("joinCaps — the security chokepoint", () => {
  it("no inputs ⇒ trusted, provenance {user}", () => {
    const c = joinCaps([]);
    expect(c.trusted).toBe(true);
    expect([...c.provenance]).toEqual([SOURCE_USER]);
  });

  it("trusted = AND of inputs", () => {
    expect(joinCaps([userTrusted(), userTrusted()]).trusted).toBe(true);
    expect(joinCaps([userTrusted(), toolResultCap("gmail")]).trusted).toBe(false);
    expect(joinCaps([toolResultCap("a"), toolResultCap("b")]).trusted).toBe(false);
  });

  it("provenance = UNION of inputs (sources never dropped)", () => {
    const c = joinCaps([toolResultCap("gmail"), toolResultCap("crm"), userTrusted()]);
    expect(c.provenance).toEqual(new Set([mcpSource("gmail"), mcpSource("crm"), SOURCE_USER]));
  });

  it("one untrusted input taints the whole combination", () => {
    const many = [userTrusted(), userTrusted(), toolResultCap("x"), userTrusted()];
    expect(joinCaps(many).trusted).toBe(false);
  });
});

describe("quarantineCap — always untrusted", () => {
  it("is untrusted even when the source was trusted", () => {
    const c = quarantineCap(userTrusted());
    expect(c.trusted).toBe(false);
    expect(c.provenance.has(SOURCE_QUARANTINE)).toBe(true);
    expect(c.provenance.has(SOURCE_USER)).toBe(true);
  });

  it("carries the source provenance forward", () => {
    const c = quarantineCap(toolResultCap("gmail"));
    expect(c.provenance.has(mcpSource("gmail"))).toBe(true);
    expect(c.trusted).toBe(false);
  });
});

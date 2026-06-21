import { describe, expect, it } from "vitest";
import type {
  Planner,
  PlanResult,
  PolicyEngine,
  QuarantineClient,
  ToolProvider,
  TypedTool,
} from "@ikarus/shared";
import { createInterpreter } from "@ikarus/interpreter";
import { runTask, type RunTaskDeps } from "../src/index.js";

const CATALOG: TypedTool[] = [{ mcpId: "svc", name: "ping", effect: "read", params: [] }];

const tools: ToolProvider = {
  catalog: () => CATALOG,
  invoke: async () => "pong",
};
const quarantine: QuarantineClient = { query: async () => "n/a" };
const policy: PolicyEngine = { check: () => ({ verdict: "allow", reason: "ok" }) };

function makeDeps(planner: Planner): RunTaskDeps {
  return { planner, interpreter: createInterpreter(), tools, quarantine, policy };
}

const VALID = `r = svc.ping()\nreturn r`;
const INVALID = `r = nope()\nreturn r`; // invalid call target → semantic error

describe("runTask — planner repair loop (§7.3)", () => {
  it("repairs an invalid first plan using the trusted compile error, then runs", async () => {
    let calls = 0;
    const planner: Planner = {
      async plan(): Promise<PlanResult> {
        calls++;
        return { source: INVALID };
      },
      async repair(_t, _c, _p, error): Promise<PlanResult> {
        calls++;
        expect(error).toMatch(/invalid call target/); // trusted error fed back
        return { source: VALID };
      },
    };
    const result = await runTask("do it", makeDeps(planner));
    expect(result.status).toBe("completed");
    expect(result.result).toBe("pong");
    expect(calls).toBe(2); // one plan + one repair
  });

  it("gives up with an error result when the planner never produces valid LPL", async () => {
    const planner: Planner = {
      async plan() {
        return { source: INVALID };
      },
      async repair() {
        return { source: INVALID };
      },
    };
    const result = await runTask("do it", { ...makeDeps(planner), maxPlanAttempts: 3 });
    expect(result.status).toBe("error");
    expect(result.error).toMatch(/planner could not produce a valid program/);
  });

  it("runs a valid first plan with no repair", async () => {
    let repairs = 0;
    const planner: Planner = {
      async plan() {
        return { source: VALID };
      },
      async repair() {
        repairs++;
        return { source: VALID };
      },
    };
    const result = await runTask("do it", makeDeps(planner));
    expect(result.status).toBe("completed");
    expect(repairs).toBe(0);
  });
});

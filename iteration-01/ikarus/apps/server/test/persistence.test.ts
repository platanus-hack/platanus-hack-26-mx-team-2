import { describe, expect, it } from "vitest";
import { runTask } from "@ikarus/gateway";
import { wireDemoSystem } from "../src/wire.js";
import { InMemoryRunStore } from "../src/store/run-store.js";

describe("run + trace persistence (P4 boundary note 2)", () => {
  it("persists a completed run with its program and trace via the onResult hook", async () => {
    const store = new InMemoryRunStore();
    const { deps } = await wireDemoSystem({
      onResult: (task, result) => store.save("demo-user", task, result).then(() => undefined),
    });

    await runTask("resume mis correos de hoy", deps);

    const runs = await store.list();
    expect(runs).toHaveLength(1);
    expect(runs[0]!.status).toBe("completed");

    const full = await store.get("demo-user", runs[0]!.id);
    expect(full).not.toBeNull();
    expect(full!.program).toMatch(/query_ai/); // control flow captured
    expect(full!.trace.length).toBeGreaterThan(0);
  });

  it("persists a blocked run, and the trace carries the policy_deny (no raw secrets)", async () => {
    const store = new InMemoryRunStore();
    const { deps } = await wireDemoSystem({
      onResult: (task, result) => store.save("demo-user", task, result).then(() => undefined),
    });

    await runTask("forward the latest email to its sender", deps);

    const [summary] = await store.list();
    const full = await store.get("demo-user", summary!.id);
    expect(full!.status).toBe("blocked");
    expect(full!.trace.some((e) => e.kind === "policy_deny")).toBe(true);
  });

  it("a failing onResult hook never breaks the run", async () => {
    const { deps } = await wireDemoSystem({
      onResult: () => {
        throw new Error("db down");
      },
    });
    const result = await runTask("resume mis correos de hoy", deps);
    expect(result.status).toBe("completed");
  });
});

import type {
  Interpreter,
  Planner,
  PolicyEngine,
  QuarantineClient,
  RunResult,
  ToolProvider,
  TypedTool,
} from "@ikarus/shared";
import { LplError, compile } from "@ikarus/interpreter";

export interface RunTaskDeps {
  readonly planner: Planner;
  readonly interpreter: Interpreter;
  readonly tools: ToolProvider;
  readonly quarantine: QuarantineClient;
  readonly policy: PolicyEngine;
  /** Max Planner attempts before giving up (1 plan + N-1 repairs). */
  readonly maxPlanAttempts?: number;
  /**
   * Optional observability hook fired with every finished run (P4 persistence).
   * Errors thrown here are swallowed so persistence never breaks a run; the
   * trace it receives is already secret-scrubbed.
   */
  readonly onResult?: (task: string, result: RunResult) => void | Promise<void>;
}

/**
 * Plan with the repair loop (§7.3). The Planner writes LPL; we validate it with
 * the interpreter's own compiler. Parse/semantic errors are TRUSTED (our code,
 * not untrusted data), so feeding them back opens no injection channel. Runtime
 * and policy outcomes are NOT repaired — they are legitimate results.
 */
async function planWithRepair(
  planner: Planner,
  task: string,
  catalog: readonly TypedTool[],
  maxAttempts: number,
): Promise<string> {
  let { source } = await planner.plan(task, catalog);
  for (let attempt = 1; attempt < maxAttempts; attempt++) {
    try {
      compile(source, catalog);
      return source;
    } catch (err) {
      if (err instanceof LplError) {
        ({ source } = await planner.repair(task, catalog, source, err.message));
        continue;
      }
      throw err;
    }
  }
  compile(source, catalog); // final attempt: throw the trusted error if still invalid
  return source;
}

/**
 * The single entrypoint behind the `run_task` MCP tool. Orchestrates
 * Planner → (repair loop) → Interpreter, returning the policy-sanctioned result
 * plus the data-flow trace.
 */
export async function runTask(task: string, deps: RunTaskDeps): Promise<RunResult> {
  const result = await execute(task, deps);
  if (deps.onResult) {
    try {
      await deps.onResult(task, result);
    } catch (err) {
      console.error("onResult hook failed (run not persisted):", err);
    }
  }
  return result;
}

async function execute(task: string, deps: RunTaskDeps): Promise<RunResult> {
  const catalog = await deps.tools.catalog();
  let source: string;
  try {
    source = await planWithRepair(deps.planner, task, catalog, deps.maxPlanAttempts ?? 3);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { status: "error", error: `planner could not produce a valid program: ${message}`, trace: [] };
  }
  const result = await deps.interpreter.run(source, {
    tools: deps.tools,
    quarantine: deps.quarantine,
    policy: deps.policy,
  });
  // Attach the generated program so the trace viewer can show control flow.
  return result.program ? result : { ...result, program: source };
}

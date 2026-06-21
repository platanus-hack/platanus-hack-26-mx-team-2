import type { RunResult } from "../types/run.js";
import type { ToolProvider } from "./tool-provider.js";
import type { QuarantineClient } from "./quarantine.js";
import type { PolicyEngine } from "./policy-engine.js";

export interface InterpreterDeps {
  readonly tools: ToolProvider;
  readonly quarantine: QuarantineClient;
  readonly policy: PolicyEngine;
}

/**
 * Executes an LPL program: lex → parse → semantic check → evaluate, tracking
 * capabilities per value and gating every tool call through the policy.
 * Implemented by @ikarus/interpreter.
 */
export interface Interpreter {
  run(source: string, deps: InterpreterDeps): Promise<RunResult>;
}

import type { TypedTool } from "../types/tool-catalog.js";

export interface PlanResult {
  /** LPL source text the interpreter will lex/parse/check. */
  readonly source: string;
}

/**
 * The Planner (§7.1): an internal, trusted LLM that turns the user's COMPLETE
 * task into an LPL program BEFORE any untrusted data is seen. Implemented by
 * @ikarus/llm. The security guarantee does not depend on the Planner being
 * correct — only on the interpreter's control/data separation.
 */
export interface Planner {
  plan(task: string, catalog: readonly TypedTool[]): Promise<PlanResult>;
  /**
   * Repair loop (§7.3): given a previous attempt and a TRUSTED error from our
   * parser/semantic checker, produce a corrected program.
   */
  repair(task: string, catalog: readonly TypedTool[], previous: string, error: string): Promise<PlanResult>;
}

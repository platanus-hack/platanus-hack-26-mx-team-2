import type { CapabilitySnapshot } from "./capability.js";
import type { Verdict } from "./policy.js";

/**
 * Data-flow trace events (§6.4, §11). The engine emits these; the UI renders
 * them. This shape is a hard cross-team contract — the interpreter writes it,
 * the trace viewer reads it. NEVER place raw secrets/credentials in a trace.
 */
export type TraceKind =
  | "plan"
  | "tool_call"
  | "query_ai"
  | "policy_deny"
  | "return"
  | "error";

export interface TracedArg {
  /** Truncated, secret-scrubbed preview of the argument value. */
  readonly preview: string;
  readonly cap: CapabilitySnapshot;
}

export interface TraceEvent {
  readonly seq: number;
  readonly kind: TraceKind;
  readonly mcpId?: string;
  readonly toolName?: string;
  readonly args?: Readonly<Record<string, TracedArg>>;
  readonly verdict?: Verdict;
  readonly ruleId?: string;
  /** Free-form detail (plan source, error message, block reason). */
  readonly detail?: string;
}

import type { CapabilitySnapshot } from "./capability.js";
import type { TraceEvent } from "./trace.js";

export type RunStatus = "completed" | "blocked" | "error";

/** The task as received by run_task. Must be COMPLETE, not partial (§7.5). */
export interface RunRequest {
  readonly task: string;
}

export interface RunResult {
  readonly status: RunStatus;
  /** Policy-sanctioned result value (present when status === "completed"). */
  readonly result?: unknown;
  /**
   * Capability of the returned value. The gateway uses this to LABEL untrusted
   * data that flows back to the agent (§7.5) — a returned value derived from
   * untrusted sources is not trusted just because it was returned.
   */
  readonly resultCap?: CapabilitySnapshot;
  /** The generated LPL program source (auditable). */
  readonly program?: string;
  readonly trace: readonly TraceEvent[];
  /** Present when status is "blocked" or "error". */
  readonly error?: string;
}

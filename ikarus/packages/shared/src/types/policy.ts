import type { ToolEffect } from "./tool-catalog.js";

export type Verdict = "allow" | "deny";

/**
 * A declarative policy rule (§7.10). Vocabulary:
 *   <tool> : <effect> → <sensitiveArgs> must be <trusted|any>
 * resolving to allow/deny. Default-secure: a `sink` denies when any sensitive
 * arg has untrusted provenance.
 */
export interface PolicyRule {
  readonly id: string;
  readonly mcpId: string;
  readonly toolName: string;
  readonly effect: ToolEffect;
  /** Argument names that must satisfy the trust requirement. */
  readonly sensitiveArgs: readonly string[];
  /** If true, every sensitive arg must be trusted, else the call is denied. */
  readonly requireTrusted: boolean;
}

export interface PolicyDecision {
  readonly verdict: Verdict;
  /** The rule that produced the decision, if any. */
  readonly ruleId?: string;
  /** Human-readable explanation for the trace viewer. */
  readonly reason: string;
}

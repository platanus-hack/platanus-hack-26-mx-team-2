import type { CapabilitySnapshot } from "../types/capability.js";
import type { ToolEffect } from "../types/tool-catalog.js";
import type { PolicyDecision } from "../types/policy.js";

export interface PolicyArg {
  readonly name: string;
  readonly cap: CapabilitySnapshot;
}

/** Everything the policy needs to decide on a single tool call, evaluated
 *  BEFORE the side effect, over the capabilities of the arguments (§6.4). */
export interface ToolCallContext {
  readonly mcpId: string;
  readonly tool: string;
  readonly effect: ToolEffect;
  readonly args: readonly PolicyArg[];
}

/** Declarative policy engine (§7.10). Implemented by @ikarus/policy. */
export interface PolicyEngine {
  check(ctx: ToolCallContext): PolicyDecision;
}

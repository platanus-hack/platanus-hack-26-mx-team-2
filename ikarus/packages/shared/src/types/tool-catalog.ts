import type { TypeRef } from "./type-ref.js";

/**
 * Effect classification (§6.4, §7.10). `read` tools have no external effect;
 * `sink` tools act on the world (send, publish, pay, delete) and are gated by
 * policy on the capabilities of their sensitive arguments.
 */
export type ToolEffect = "read" | "sink";

export interface TypedParam {
  readonly name: string;
  readonly type: TypeRef;
  readonly required: boolean;
  readonly description?: string;
}

/** A single upstream MCP tool, mapped into the interpreter's type system. */
export interface TypedTool {
  readonly mcpId: string;
  readonly name: string;
  readonly description?: string;
  readonly params: readonly TypedParam[];
  readonly effect: ToolEffect;
}

import type { TypedTool } from "../types/tool-catalog.js";

/**
 * The interpreter's view of the upstream world. Implemented by @ikarus/gateway
 * over the live MCP connection pool; faked in interpreter unit tests.
 *
 * The interpreter never knows about transports, processes, or credentials —
 * only this interface.
 */
export interface ToolProvider {
  /** The typed catalog of every available upstream tool. */
  catalog(): Promise<readonly TypedTool[]> | readonly TypedTool[];
  /** Execute a real upstream tool call. Return value is raw (untrusted) data. */
  invoke(mcpId: string, tool: string, args: Readonly<Record<string, unknown>>): Promise<unknown>;
}

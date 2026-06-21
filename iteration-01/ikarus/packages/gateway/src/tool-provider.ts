import type { ToolProvider, TypedTool } from "@ikarus/shared";
import type { ConnectionManager } from "./upstream/connection-manager.js";
import { introspect } from "./upstream/introspect.js";
import { defaultEffectClassifier, type EffectClassifier } from "./upstream/effect.js";

interface CallToolResult {
  content?: Array<{ type: string; text?: string; [k: string]: unknown }>;
  structuredContent?: unknown;
  isError?: boolean;
}

/**
 * Extract a plain value from an MCP tool result for the interpreter. Prefers
 * `structuredContent`; otherwise parses a single text block as JSON (falling
 * back to the raw string). The returned value is raw, untrusted upstream data.
 */
export function extractResult(res: CallToolResult): unknown {
  if (res.isError) {
    const msg = res.content?.map((c) => c.text ?? "").join("\n") || "upstream tool error";
    throw new Error(msg);
  }
  if (res.structuredContent !== undefined) return res.structuredContent;
  const texts = (res.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "");
  if (texts.length === 0) return res.content ?? null;
  const joined = texts.join("\n");
  try {
    return JSON.parse(joined);
  } catch {
    return joined;
  }
}

/**
 * Implements the interpreter's `ToolProvider` over the live upstream pool. The
 * interpreter sees only typed tools and invoke(); it never knows about
 * transports, processes, or credentials.
 */
export class GatewayToolProvider implements ToolProvider {
  private cache?: readonly TypedTool[];

  constructor(
    private readonly cm: ConnectionManager,
    private readonly classify: EffectClassifier = defaultEffectClassifier,
  ) {}

  async catalog(): Promise<readonly TypedTool[]> {
    if (this.cache) return this.cache;
    const all: TypedTool[] = [];
    let allOk = true;
    for (const id of this.cm.ids()) {
      try {
        const client = await this.cm.getClient(id);
        all.push(...(await introspect(client, id, this.classify)));
      } catch (err) {
        // Isolate failures: one unreachable upstream must not break the whole
        // gateway. Skip it and surface a partial catalog.
        allOk = false;
        console.warn(`[gateway] skipping upstream '${id}': ${(err as Error).message}`);
      }
    }
    // Only cache a complete catalog, so a transiently-down upstream is retried.
    if (allOk) this.cache = all;
    return all;
  }

  /** Force a fresh introspection on next catalog() (e.g. after a reconnect). */
  refresh(): void {
    this.cache = undefined;
  }

  async invoke(mcpId: string, tool: string, args: Readonly<Record<string, unknown>>): Promise<unknown> {
    const callArgs = { name: tool, arguments: { ...args } };
    let res: CallToolResult;
    try {
      res = (await (await this.cm.getClient(mcpId)).callTool(callArgs)) as CallToolResult;
    } catch (err) {
      // A thrown error here is a transport/protocol failure (tool-level errors
      // come back as { isError: true }, not throws). Reconnect once and retry.
      // NOTE: at-least-once for side-effecting tools if the failure happened
      // after upstream execution — inherent to any transport retry.
      void err;
      await this.cm.reset(mcpId);
      this.refresh();
      res = (await (await this.cm.getClient(mcpId)).callTool(callArgs)) as CallToolResult;
    }
    // OUTSIDE the retry on purpose: extractResult throws on a tool-level error
    // (isError). Retrying that would re-execute a side-effecting tool.
    return extractResult(res);
  }
}

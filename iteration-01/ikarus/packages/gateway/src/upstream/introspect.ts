import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { TypedTool } from "@ikarus/shared";
import { inputSchemaToParams, type JsonSchema } from "../schema/json-schema-to-type.js";
import { defaultEffectClassifier, type EffectClassifier } from "./effect.js";

/**
 * Introspect one upstream MCP: `list_tools` → typed catalog. Each tool's input
 * JSON Schema is mapped into the interpreter's type system and its effect
 * classified. The result is structural/trusted data and may be cached (distinct
 * from the Quarantine no-cache rule, §7.6).
 */
export async function introspect(
  client: Client,
  mcpId: string,
  classify: EffectClassifier = defaultEffectClassifier,
): Promise<TypedTool[]> {
  const out: TypedTool[] = [];
  let cursor: string | undefined;
  // Page through list_tools — a server with many tools paginates via nextCursor.
  do {
    const page = await client.listTools(cursor ? { cursor } : undefined);
    for (const t of page.tools) {
      const desc = typeof t.description === "string" ? t.description : undefined;
      out.push({
        mcpId,
        name: t.name,
        params: inputSchemaToParams(t.inputSchema as JsonSchema),
        effect: classify({ name: t.name, ...(t.annotations ? { annotations: t.annotations } : {}) }),
        ...(desc ? { description: desc } : {}),
      });
    }
    cursor = page.nextCursor;
  } while (cursor);
  return out;
}

import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { formatType, type TypedTool } from "@ikarus/shared";
import { runTask, type RunTaskDeps } from "./run-task.js";

const RUN_TASK_DESCRIPTION = `Execute a task safely through Ikarus, which is immune to prompt injection by design.

Ikarus connects to your real tools (email, calendar, CRM, etc.) behind a defense that separates control flow from data flow: untrusted content (emails, web pages, tickets) can NEVER change which actions are taken.

HOW TO USE:
- Pass the COMPLETE task in a single call. Do NOT fragment it across calls and do NOT ask Ikarus to "first read, then decide" — the execution plan is fixed once, up front, from your task alone.
- State the full intent: what to read, what to produce, and any action to take.
- To discover the available tools, read the catalog resources at ikarus://catalog/<mcp_id>.

Returns the policy-sanctioned result. Actions whose sensitive arguments derive from untrusted data are blocked, not executed.`;

function toolSignature(t: TypedTool): string {
  const params = t.params
    .map((p) => `${p.name}${p.required ? "" : "?"}: ${formatType(p.type)}`)
    .join(", ");
  return `${t.mcpId}.${t.name}(${params})`;
}

function renderCatalog(tools: readonly TypedTool[]) {
  return tools.map((t) => ({
    signature: toolSignature(t),
    effect: t.effect,
    ...(t.description ? { description: t.description } : {}),
  }));
}

/**
 * Build the single public MCP surface: the `run_task` tool plus a per-MCP
 * catalog resource (§6.6). Stateless-friendly — a fresh server can be created
 * per request; all shared state (upstream pool, caches) lives in `deps`.
 */
export function createMcpServer(deps: RunTaskDeps): McpServer {
  const server = new McpServer({ name: "ikarus", version: "0.0.0" });

  server.registerTool(
    "run_task",
    {
      title: "Run a task safely",
      description: RUN_TASK_DESCRIPTION,
      inputSchema: {
        task: z.string().describe("The complete task, in natural language. Must not be partial."),
      },
    },
    async ({ task }) => {
      const result = await runTask(task, deps);
      const payload =
        result.status === "completed"
          ? { status: result.status, result: result.result }
          : { status: result.status, error: result.error };
      return {
        content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
      };
    },
  );

  server.registerResource(
    "catalog",
    new ResourceTemplate("ikarus://catalog/{mcpId}", {
      list: async () => {
        const catalog = await deps.tools.catalog();
        const ids = [...new Set(catalog.map((t) => t.mcpId))];
        return {
          resources: ids.map((id) => ({
            uri: `ikarus://catalog/${id}`,
            name: `Catalog: ${id}`,
            mimeType: "application/json",
          })),
        };
      },
    }),
    {
      title: "Upstream tool catalog",
      description: "Typed tool catalog for one connected MCP, for formulating tasks.",
    },
    async (uri, variables) => {
      const mcpId = String(variables.mcpId);
      const catalog = await deps.tools.catalog();
      const tools = catalog.filter((t) => t.mcpId === mcpId);
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify({ mcpId, tools: renderCatalog(tools) }, null, 2),
          },
        ],
      };
    },
  );

  return server;
}

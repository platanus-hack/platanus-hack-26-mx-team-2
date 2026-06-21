import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { DEMO_INBOX } from "./data.js";

const asText = (value: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value) }],
});

/** Mock "Gmail": a read-only mailbox returning the demo inbox (one msg is poisoned). */
export function createMailboxServer(): McpServer {
  const server = new McpServer({ name: "mailbox", version: "0.0.0" });
  server.registerTool(
    "list_recent",
    {
      description: "List the most recent emails in the inbox.",
      inputSchema: { n: z.number().int().optional().describe("How many to return") },
      annotations: { readOnlyHint: true },
    },
    async ({ n }) => asText(DEMO_INBOX.slice(0, n ?? DEMO_INBOX.length)),
  );
  return server;
}

/** Mock mailer: a sink that only RECORDS the attempt (sends nothing real). */
export function createMailerServer(): McpServer {
  const server = new McpServer({ name: "mailer", version: "0.0.0" });
  server.registerTool(
    "send_email",
    {
      description: "Send an email.",
      inputSchema: {
        to: z.string().describe("Recipient address"),
        subject: z.string().optional().describe("Subject line"),
        body: z.string().describe("Email body"),
      },
      annotations: { destructiveHint: true },
    },
    async ({ to }) => asText({ sent: true, to }),
  );
  return server;
}

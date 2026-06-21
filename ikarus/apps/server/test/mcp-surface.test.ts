import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "@ikarus/gateway";
import { wireDemoSystem } from "../src/wire.js";

async function connectClient(): Promise<Client> {
  const { deps } = await wireDemoSystem();
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  await createMcpServer(deps).connect(serverT);
  const client = new Client({ name: "test-agent", version: "0.0.0" });
  await client.connect(clientT);
  return client;
}

function callPayload(res: { content: Array<{ type: string; text?: string }> }): {
  status: string;
  result?: unknown;
  error?: string;
} {
  const text = res.content.find((c) => c.type === "text")?.text ?? "{}";
  return JSON.parse(text);
}

describe("MCP surface (real client over in-memory transport)", () => {
  it("exposes exactly one tool: run_task", async () => {
    const client = await connectClient();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(["run_task"]);
  });

  it("lists a catalog resource per upstream MCP", async () => {
    const client = await connectClient();
    const { resources } = await client.listResources();
    const uris = resources.map((r) => r.uri).sort();
    expect(uris).toEqual(["ikarus://catalog/mailbox", "ikarus://catalog/mailer"]);
  });

  it("reads a per-MCP catalog with typed signatures and effects", async () => {
    const client = await connectClient();
    const res = await client.readResource({ uri: "ikarus://catalog/mailer" });
    const body = JSON.parse(res.contents[0]!.text as string);
    expect(body.mcpId).toBe("mailer");
    expect(body.tools[0].signature).toBe("mailer.send_email(to: str, body: str)");
    expect(body.tools[0].effect).toBe("sink");
  });

  it("run_task summarizes and returns a clean result (injection inert)", async () => {
    const client = await connectClient();
    const res = await client.callTool({ name: "run_task", arguments: { task: "resume mis correos" } });
    const payload = callPayload(res as never);
    expect(payload.status).toBe("completed");
    expect(String(payload.result)).not.toMatch(/attacker@evil\.com/);
  });

  it("run_task blocks an action whose recipient derives from untrusted data", async () => {
    const client = await connectClient();
    const res = await client.callTool({
      name: "run_task",
      arguments: { task: "forward the latest email to its sender" },
    });
    const payload = callPayload(res as never);
    expect(payload.status).toBe("blocked");
    expect(payload.error).toMatch(/policy blocked/);
  });
});

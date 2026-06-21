import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ConnectionManager, GatewayToolProvider } from "../src/index.js";

function makeUpstream(): McpServer {
  const s = new McpServer({ name: "t", version: "0.0.0" });
  s.registerTool(
    "get_item",
    {
      description: "fetch an item",
      inputSchema: { id: z.string() },
      annotations: { readOnlyHint: true },
    },
    async ({ id }) => ({ content: [{ type: "text", text: JSON.stringify({ id, val: 42 }) }] }),
  );
  s.registerTool(
    "delete_item",
    { inputSchema: { id: z.string() }, annotations: { destructiveHint: true } },
    async () => ({ content: [{ type: "text", text: JSON.stringify({ ok: true }) }] }),
  );
  return s;
}

async function wire(): Promise<ConnectionManager> {
  const cm = new ConnectionManager();
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  await makeUpstream().connect(serverT);
  const client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(clientT);
  cm.registerClient("svc", client);
  return cm;
}

describe("aggregator: introspect → typed catalog → invoke", () => {
  it("introspects tools with typed params and classified effects", async () => {
    const tools = new GatewayToolProvider(await wire());
    const catalog = await tools.catalog();
    const get = catalog.find((t) => t.name === "get_item")!;
    const del = catalog.find((t) => t.name === "delete_item")!;
    expect(get.effect).toBe("read");
    expect(del.effect).toBe("sink");
    expect(get.params).toEqual([{ name: "id", type: { kind: "str" }, required: true }]);
    expect(get.mcpId).toBe("svc");
  });

  it("caches the catalog across calls", async () => {
    const tools = new GatewayToolProvider(await wire());
    const a = await tools.catalog();
    const b = await tools.catalog();
    expect(a).toBe(b);
  });

  it("invokes a tool and extracts the structured result", async () => {
    const tools = new GatewayToolProvider(await wire());
    const result = await tools.invoke("svc", "get_item", { id: "x1" });
    expect(result).toEqual({ id: "x1", val: 42 });
  });

  it("throws on an unknown upstream", async () => {
    const tools = new GatewayToolProvider(await wire());
    await expect(tools.invoke("nope", "get_item", {})).rejects.toThrow(/unknown upstream/);
  });
});

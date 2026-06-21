import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ConnectionManager, GatewayToolProvider, extractResult } from "../src/index.js";

describe("extractResult", () => {
  it("prefers structuredContent", () => {
    expect(extractResult({ structuredContent: { a: 1 }, content: [] })).toEqual({ a: 1 });
  });
  it("parses a single JSON text block", () => {
    expect(extractResult({ content: [{ type: "text", text: '{"x":2}' }] })).toEqual({ x: 2 });
  });
  it("falls back to the raw string for non-JSON text", () => {
    expect(extractResult({ content: [{ type: "text", text: "hello" }] })).toBe("hello");
  });
  it("throws on a tool-level error", () => {
    expect(() => extractResult({ isError: true, content: [{ type: "text", text: "boom" }] })).toThrow(
      /boom/,
    );
  });
  it("returns null-ish for empty content", () => {
    expect(extractResult({ content: [] })).toEqual([]);
  });
});

// A server whose tool counts executions and returns a tool-level error.
function makeFailingServer(counter: { n: number }): McpServer {
  const s = new McpServer({ name: "f", version: "0.0.0" });
  s.registerTool("act", { inputSchema: {} }, async () => {
    counter.n++;
    return { content: [{ type: "text", text: "upstream failure" }], isError: true };
  });
  return s;
}

async function linkClient(server: McpServer): Promise<Client> {
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await server.connect(st);
  const client = new Client({ name: "t", version: "0.0.0" });
  await client.connect(ct);
  return client;
}

describe("invoke — does NOT re-execute a side-effecting tool on a tool-level error", () => {
  it("calls the tool exactly once when it returns isError", async () => {
    const counter = { n: 0 };
    const cm = new ConnectionManager();
    cm.registerClient("svc", await linkClient(makeFailingServer(counter)));
    const tools = new GatewayToolProvider(cm);
    await expect(tools.invoke("svc", "act", {})).rejects.toThrow(/upstream failure/);
    expect(counter.n).toBe(1); // not 2 — the retry must not re-run the tool
  });
});

describe("catalog — one unreachable upstream does not break the rest", () => {
  it("returns a partial catalog and does not cache it", async () => {
    function makeGood(): McpServer {
      const s = new McpServer({ name: "g", version: "0.0.0" });
      s.registerTool("ping", { inputSchema: {}, annotations: { readOnlyHint: true } }, async () => ({
        content: [{ type: "text", text: "ok" }],
      }));
      return s;
    }

    class FlakyCM extends ConnectionManager {
      override getClient(id: string): Promise<Client> {
        if (id === "bad") return Promise.reject(new Error("down"));
        return super.getClient(id);
      }
    }

    const cm = new FlakyCM();
    cm.registerClient("good", await linkClient(makeGood()));
    cm.registerClient("bad", {} as Client); // present in ids(), but getClient rejects

    const tools = new GatewayToolProvider(cm);
    const cat1 = await tools.catalog();
    expect(cat1.map((t) => t.mcpId)).toEqual(["good"]);
    // Not cached (partial) → a second call retries and still returns the good one.
    const cat2 = await tools.catalog();
    expect(cat2).not.toBe(cat1);
    expect(cat2.map((t) => t.name)).toEqual(["ping"]);
  });
});

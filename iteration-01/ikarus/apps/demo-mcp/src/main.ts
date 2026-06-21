import http from "node:http";
import { randomUUID } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createMailboxServer, createMailerServer } from "./servers.js";

/**
 * Standalone demo MCP service (no auth) — both upstreams in one process for an
 * easy demo. Add these as real HTTP connections in Ikarus:
 *   mailbox → http://localhost:8900/mailbox/mcp   (read; carries the injection)
 *   mailer  → http://localhost:8900/mailer/mcp    (sink)
 * Verifying them maps the tools; running a task drives the prompt-injection demo.
 */

// Own var (not PORT) so sourcing the root .env — which sets PORT for the main
// server — can't hijack this service onto the server's port.
const PORT = Number(process.env.DEMO_MCP_PORT ?? 8900);

function readBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve(undefined);
      try {
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

/** One stateful Streamable-HTTP mount: a session map + a fresh server per session. */
function mount(factory: () => McpServer) {
  const transports = new Map<string, StreamableHTTPServerTransport>();
  return async (req: http.IncomingMessage, res: http.ServerResponse): Promise<void> => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    let transport = sessionId ? transports.get(sessionId) : undefined;

    if (req.method === "POST") {
      const body = await readBody(req);
      if (!transport) {
        if (!isInitializeRequest(body)) {
          res.writeHead(400, { "content-type": "application/json" }).end(
            JSON.stringify({
              jsonrpc: "2.0",
              error: { code: -32000, message: "No valid session; send an initialize request first." },
              id: null,
            }),
          );
          return;
        }
        const newTransport: StreamableHTTPServerTransport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          enableJsonResponse: true,
          onsessioninitialized: (sid) => {
            transports.set(sid, newTransport);
          },
        });
        newTransport.onclose = () => {
          if (newTransport.sessionId) transports.delete(newTransport.sessionId);
        };
        await factory().connect(newTransport);
        transport = newTransport;
      }
      await transport.handleRequest(req, res, body);
      return;
    }

    if (req.method === "GET" || req.method === "DELETE") {
      if (!transport) {
        res.writeHead(400).end("Unknown or missing session id");
        return;
      }
      await transport.handleRequest(req, res);
      return;
    }
    res.writeHead(405).end();
  };
}

const mounts: Record<string, (req: http.IncomingMessage, res: http.ServerResponse) => Promise<void>> = {
  "/mailbox/mcp": mount(createMailboxServer),
  "/mailer/mcp": mount(createMailerServer),
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  if (url.pathname === "/health") {
    res.writeHead(200, { "content-type": "text/plain" }).end("ok");
    return;
  }
  const handler = mounts[url.pathname];
  if (!handler) {
    res.writeHead(404).end();
    return;
  }
  try {
    await handler(req, res);
  } catch (err) {
    console.error("request error:", err);
    if (!res.headersSent) res.writeHead(500).end("internal error");
  }
});

server.listen(PORT, () => {
  console.error(`Demo MCP listening on http://localhost:${PORT}  (mailbox: /mailbox/mcp · mailer: /mailer/mcp)`);
});

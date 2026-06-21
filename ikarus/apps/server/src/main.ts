import http from "node:http";
import { randomUUID } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { createMcpServer, type RunTaskDeps } from "@ikarus/gateway";
import { wireDemoSystem } from "./wire.js";
import { resolveWorkspaceOptions, buildUserWiredSystem, type UserSystem } from "./workspace.js";
import { handleApi } from "./api/router.js";
import { handleOAuthCallback, isOAuthCallback } from "./oauth.js";
import { AuthError, verifyMcpKey } from "./auth.js";
import { closeDb, hasDatabase } from "./db.js";

const PORT = Number(process.env.PORT ?? 8787);

/** Permissive CORS for the SPA (served from a separate static origin). */
function applyCors(res: http.ServerResponse): void {
  res.setHeader("access-control-allow-origin", process.env.WEB_ORIGIN ?? "*");
  res.setHeader("access-control-allow-methods", "GET,POST,PUT,DELETE,OPTIONS");
  res.setHeader("access-control-allow-headers", "authorization,content-type,mcp-session-id");
  res.setHeader("access-control-expose-headers", "mcp-session-id");
}

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

// Resolve the MCP workspace config (DB-loaded policies/models + run persistence
// when DATABASE_URL + IKARUS_WORKSPACE_USER are set; otherwise the offline demo).
const wireOpts = await resolveWorkspaceOptions();
const { deps, cm, usingRealLlm } = await wireDemoSystem(wireOpts);
console.error(
  `db: ${hasDatabase() ? "on" : "off (in-memory)"} · ` +
    `planner: ${usingRealLlm.planner ? "real LLM" : "stub"} · ` +
    `quarantine: ${usingRealLlm.quarantine ? "real LLM" : "stub"}`,
);

// Per-user MCP workspaces, built lazily after the personal key authenticates and
// cached for the process lifetime. Without a key, requests fall back to the global
// workspace above (IKARUS_WORKSPACE_USER / offline demo).
const userSystems = new Map<string, UserSystem>();

async function resolveDeps(authorization: string | undefined): Promise<RunTaskDeps> {
  if (!authorization) return deps; // dev/demo fallback to the global workspace
  const user = await verifyMcpKey(authorization); // throws AuthError on a bad key
  let sys = userSystems.get(user.id);
  if (!sys) {
    sys = await buildUserWiredSystem(user.id);
    userSystems.set(user.id, sys);
  }
  return sys.deps;
}

// Stateful Streamable HTTP: one transport+server per MCP session, kept alive in
// this long-running process (NOT serverless). Sessions are keyed by Mcp-Session-Id.
const transports = new Map<string, StreamableHTTPServerTransport>();

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  applyCors(res);

  if (req.method === "OPTIONS") {
    res.writeHead(204).end();
    return;
  }
  if (url.pathname === "/health") {
    res.writeHead(200, { "content-type": "text/plain" }).end("ok");
    return;
  }
  // OAuth redirect target — authenticated by the unguessable `state`, not a JWT.
  if (isOAuthCallback(url.pathname)) {
    await handleOAuthCallback(req, res, url);
    return;
  }

  try {
    // REST API for the SPA (auth + CRUD). Owns any /api/* path.
    if (url.pathname.startsWith("/api/")) {
      const body = req.method === "GET" || req.method === "DELETE" ? undefined : await readBody(req);
      await handleApi(req, res, url, body);
      return;
    }

    if (url.pathname !== "/mcp") {
      res.writeHead(404).end();
      return;
    }

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
        // Authenticate at initialize: a personal key selects the user's workspace;
        // its absence falls back to the global one. The session is bound to it.
        let sessionDeps: RunTaskDeps;
        try {
          sessionDeps = await resolveDeps(req.headers.authorization);
        } catch (err) {
          if (err instanceof AuthError) {
            res.writeHead(401, { "content-type": "application/json" }).end(
              JSON.stringify({
                jsonrpc: "2.0",
                error: { code: -32001, message: err.message },
                id: null,
              }),
            );
            return;
          }
          throw err;
        }
        await createMcpServer(sessionDeps).connect(newTransport);
        transport = newTransport;
      }
      await transport.handleRequest(req, res, body);
      return;
    }

    // GET (server stream) and DELETE (session teardown) route by session id.
    if (req.method === "GET" || req.method === "DELETE") {
      if (!transport) {
        res.writeHead(400).end("Unknown or missing session id");
        return;
      }
      await transport.handleRequest(req, res);
      return;
    }

    res.writeHead(405).end();
  } catch (err) {
    console.error("request error:", err);
    if (!res.headersSent) res.writeHead(500).end("internal error");
  }
});

server.listen(PORT, () => {
  console.error(`Ikarus listening on http://localhost:${PORT} (MCP: /mcp · API: /api)`);
});

async function shutdown(): Promise<void> {
  console.error("shutting down…");
  await cm.closeAll();
  await Promise.all([...userSystems.values()].map((s) => s.cm.closeAll()));
  await closeDb();
  server.close();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

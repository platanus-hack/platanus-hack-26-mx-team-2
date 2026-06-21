import type http from "node:http";
import { AuthError, verifyToken, generateMcpKey, type AuthUser } from "../auth.js";
import { db } from "../db.js";
import { encryptSecret, last4, redactSecret } from "../crypto.js";
import { PrismaRunStore } from "../store/run-store.js";
import { introspectConnection, isMockEndpoint, toCatalogJson } from "../store/catalog.js";
import { startConnectionOAuth } from "../oauth.js";

/**
 * REST API for the SPA. Plain node:http (shares the process with the MCP raw
 * transport — no extra HTTP framework). Every route requires a verified Supabase
 * JWT; secret-bearing fields are write-only and redacted on read.
 */

const runStore = new PrismaRunStore();

interface Ctx {
  user: AuthUser;
  body: unknown;
  params: Record<string, string>;
}
type Handler = (ctx: Ctx) => Promise<unknown>;
interface Route {
  method: string;
  pattern: RegExp;
  keys: string[];
  handler: Handler;
}

function route(method: string, path: string, handler: Handler): Route {
  const keys: string[] = [];
  const pattern = new RegExp(
    "^" + path.replace(/:([A-Za-z]+)/g, (_m, k: string) => (keys.push(k), "([^/]+)")) + "$",
  );
  return { method, pattern, keys, handler };
}

/** Upsert the local User mirror of the Supabase identity on first sight. */
async function ensureUser(u: AuthUser): Promise<void> {
  await db().user.upsert({
    where: { id: u.id },
    update: { email: u.email },
    create: { id: u.id, email: u.email },
  });
}

const routes: Route[] = [
  // ---- Connections --------------------------------------------------------
  route("GET", "/api/connections", async ({ user }) => {
    const rows = await db().mcpConnection.findMany({ where: { userId: user.id }, orderBy: { createdAt: "asc" } });
    return rows.map((c) => ({
      id: c.id,
      label: c.label,
      transport: c.transport,
      endpoint: c.endpoint,
      status: c.status,
      credentials: redactSecret(c.encryptedCreds ? { last4: c.credLast4 } : null),
    }));
  }),
  route("POST", "/api/connections", async ({ user, body }) => {
    const b = body as { label: string; transport: "STDIO" | "HTTP"; endpoint: string; credentials?: string };
    const creds = b.credentials
      ? { encryptedCreds: encryptSecret(b.credentials), credLast4: last4(b.credentials) }
      : {};
    const c = await db().mcpConnection.create({
      data: { userId: user.id, label: b.label, transport: b.transport, endpoint: b.endpoint, ...creds },
    });
    return { id: c.id };
  }),
  route("PUT", "/api/connections/:id", async ({ user, params, body }) => {
    const b = body as {
      label?: string;
      transport?: "STDIO" | "HTTP";
      endpoint?: string;
      credentials?: string;
    };
    const conn = await db().mcpConnection.findFirst({ where: { id: params.id, userId: user.id } });
    if (!conn) throw new HttpError(404, "connection not found");
    // A non-empty credentials string replaces the stored secret; omitting it keeps
    // the current one (write-only, never returned). Editing fields resets status.
    const creds = b.credentials
      ? { encryptedCreds: encryptSecret(b.credentials), credLast4: last4(b.credentials) }
      : {};
    await db().mcpConnection.update({
      where: { id: conn.id },
      data: {
        ...(b.label ? { label: b.label } : {}),
        ...(b.transport ? { transport: b.transport } : {}),
        ...(b.endpoint ? { endpoint: b.endpoint } : {}),
        ...creds,
        status: "unverified",
      },
    });
    return { ok: true };
  }),
  route("DELETE", "/api/connections/:id", async ({ user, params }) => {
    await db().mcpConnection.deleteMany({ where: { id: params.id, userId: user.id } });
    return { ok: true };
  }),
  // Connect to the upstream, introspect its catalog, and cache it. Updates the
  // connection's status so the UI reflects reachability.
  route("POST", "/api/connections/:id/verify", async ({ user, params }) => {
    const conn = await db().mcpConnection.findFirst({ where: { id: params.id, userId: user.id } });
    if (!conn) throw new HttpError(404, "connection not found");
    if (isMockEndpoint(conn.endpoint)) {
      return { status: conn.status, mock: true };
    }
    try {
      const tools = await introspectConnection(conn);
      await db().mcpConnection.update({
        where: { id: conn.id },
        data: { status: "connected", catalogCache: toCatalogJson(tools) as object },
      });
      return { status: "connected", toolCount: tools.length };
    } catch (err) {
      await db().mcpConnection.update({ where: { id: conn.id }, data: { status: "error" } });
      return { status: "error", error: err instanceof Error ? err.message : String(err) };
    }
  }),
  // Begin the MCP OAuth flow for a connection: returns the URL the browser must
  // visit. The upstream redirects back to /oauth/callback, which stores the token.
  route("POST", "/api/connections/:id/oauth/start", async ({ user, params }) => {
    const conn = await db().mcpConnection.findFirst({ where: { id: params.id, userId: user.id } });
    if (!conn) throw new HttpError(404, "connection not found");
    if (isMockEndpoint(conn.endpoint)) throw new HttpError(400, "mock connections have no OAuth");
    const authorizationUrl = await startConnectionOAuth(conn, user.id);
    return { authorizationUrl: authorizationUrl.toString() };
  }),
  // Return the mapped tool catalog: cached if present, else a fresh introspect.
  route("GET", "/api/connections/:id/catalog", async ({ user, params }) => {
    const conn = await db().mcpConnection.findFirst({ where: { id: params.id, userId: user.id } });
    if (!conn) throw new HttpError(404, "connection not found");
    if (conn.catalogCache) return conn.catalogCache;
    if (isMockEndpoint(conn.endpoint)) return [];
    const tools = await introspectConnection(conn);
    await db().mcpConnection.update({
      where: { id: conn.id },
      data: { catalogCache: toCatalogJson(tools) as object },
    });
    return toCatalogJson(tools);
  }),

  // ---- Policies -----------------------------------------------------------
  route("GET", "/api/policies", async ({ user }) => {
    const rows = await db().policy.findMany({
      where: { userId: user.id },
      include: { connection: { select: { label: true } } },
    });
    return rows.map((p) => ({
      id: p.id,
      mcpId: p.connection.label,
      toolName: p.toolName,
      effect: p.effect,
      sensitiveArgs: p.sensitiveArgs,
      requireTrusted: p.requireTrusted,
    }));
  }),
  route("POST", "/api/policies", async ({ user, body }) => {
    const b = body as {
      connectionId: string;
      toolName: string;
      effect: "READ" | "SINK";
      sensitiveArgs?: string[];
      requireTrusted?: boolean;
    };
    // The connection must belong to the caller — never bind a policy to someone
    // else's upstream.
    const conn = await db().mcpConnection.findFirst({ where: { id: b.connectionId, userId: user.id } });
    if (!conn) throw new HttpError(404, "connection not found");
    const existing = await db().policy.findUnique({
      where: { connectionId_toolName: { connectionId: b.connectionId, toolName: b.toolName } },
    });
    if (existing) throw new HttpError(409, `a policy for ${conn.label}.${b.toolName} already exists`);
    const isSink = b.effect === "SINK";
    const p = await db().policy.create({
      data: {
        userId: user.id,
        connectionId: b.connectionId,
        toolName: b.toolName,
        effect: b.effect,
        sensitiveArgs: b.sensitiveArgs ?? [],
        // Default-secure: a sink requires trusted args unless explicitly opted out.
        requireTrusted: typeof b.requireTrusted === "boolean" ? b.requireTrusted : isSink,
      },
    });
    return { id: p.id };
  }),
  route("PUT", "/api/policies/:id", async ({ user, params, body }) => {
    const b = body as { effect?: "READ" | "SINK"; sensitiveArgs?: string[]; requireTrusted?: boolean };
    await db().policy.updateMany({
      where: { id: params.id, userId: user.id },
      data: {
        ...(b.effect ? { effect: b.effect } : {}),
        ...(b.sensitiveArgs ? { sensitiveArgs: b.sensitiveArgs } : {}),
        ...(typeof b.requireTrusted === "boolean" ? { requireTrusted: b.requireTrusted } : {}),
      },
    });
    return { ok: true };
  }),
  route("DELETE", "/api/policies/:id", async ({ user, params }) => {
    await db().policy.deleteMany({ where: { id: params.id, userId: user.id } });
    return { ok: true };
  }),

  // ---- Models (Planner / Quarantine) -------------------------------------
  route("GET", "/api/models", async ({ user }) => {
    const rows = await db().modelConfig.findMany({ where: { userId: user.id } });
    return rows.map((m) => ({
      role: m.role,
      provider: m.provider,
      modelId: m.modelId,
      // Configured only when a real key was stored (keyLast4 is set on write).
      apiKey: redactSecret(m.keyLast4 !== null ? { last4: m.keyLast4 } : null),
    }));
  }),
  route("PUT", "/api/models/:role", async ({ user, params, body }) => {
    const role = params.role as "PLANNER" | "QUARANTINE";
    const b = body as { provider: "ANTHROPIC" | "OPENAI"; modelId: string; apiKey?: string };
    const existing = await db().modelConfig.findUnique({ where: { userId_role: { userId: user.id, role } } });
    // A key is required to create; on update the prior key is kept when omitted.
    // Never store an empty placeholder key — that would build a broken LLM client.
    if (!existing && !b.apiKey) {
      throw new HttpError(400, "an API key is required when configuring a model for the first time");
    }
    const keyFields = b.apiKey
      ? { encryptedKey: encryptSecret(b.apiKey), keyLast4: last4(b.apiKey) }
      : undefined;
    if (existing) {
      await db().modelConfig.update({
        where: { userId_role: { userId: user.id, role } },
        data: { provider: b.provider, modelId: b.modelId, ...(keyFields ?? {}) },
      });
    } else {
      await db().modelConfig.create({
        data: { userId: user.id, role, provider: b.provider, modelId: b.modelId, ...keyFields! },
      });
    }
    return { ok: true };
  }),

  // ---- Personal MCP key ---------------------------------------------------
  route("GET", "/api/mcp-key", async ({ user }) => {
    const u = await db().user.findUnique({ where: { id: user.id }, select: { mcpKeyLast4: true } });
    return { configured: Boolean(u?.mcpKeyLast4), last4: u?.mcpKeyLast4 ?? null };
  }),
  route("POST", "/api/mcp-key", async ({ user }) => {
    // (Re)generate. The plaintext is returned ONCE and never stored.
    const key = generateMcpKey();
    await db().user.update({
      where: { id: user.id },
      data: { mcpKeyHash: key.hash, mcpKeyLast4: key.last4 },
    });
    return { key: key.plaintext, last4: key.last4 };
  }),

  // ---- Runs / traces ------------------------------------------------------
  route("GET", "/api/runs", async ({ user }) => runStore.list(user.id)),
  route("GET", "/api/runs/:id", async ({ user, params }) => {
    const run = await runStore.get(user.id, params.id ?? "");
    if (!run) throw new HttpError(404, "run not found");
    return run;
  }),
];

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Try to handle an /api request. Returns true if it owned the request (response
 * already written), false if the path is not an API route.
 */
export async function handleApi(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: URL,
  body: unknown,
): Promise<boolean> {
  if (!url.pathname.startsWith("/api/")) return false;

  const send = (status: number, payload: unknown): void => {
    res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(payload));
  };

  const match = routes.find((r) => r.method === req.method && r.pattern.test(url.pathname));
  if (!match) {
    send(404, { error: "not found" });
    return true;
  }

  try {
    const user = await verifyToken(req.headers.authorization);
    await ensureUser(user);
    const m = match.pattern.exec(url.pathname)!;
    const params: Record<string, string> = {};
    match.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1] ?? "")));
    const result = await match.handler({ user, body, params });
    send(200, result);
  } catch (err) {
    if (err instanceof AuthError) send(401, { error: err.message });
    else if (err instanceof HttpError) send(err.status, { error: err.message });
    else {
      console.error("api error:", err);
      send(500, { error: "internal error" });
    }
  }
  return true;
}

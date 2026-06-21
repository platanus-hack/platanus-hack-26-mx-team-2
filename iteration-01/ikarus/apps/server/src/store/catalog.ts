import type { McpConnection } from "@prisma/client";
import { formatType, type TypedTool } from "@ikarus/shared";
import { ConnectionManager, introspect, type UpstreamSpec } from "@ikarus/gateway";
import { classifyEffect } from "@ikarus/policy";
import { decryptSecret } from "../crypto.js";

/**
 * Live introspection of a user's saved MCP connection, reusing the gateway's
 * ConnectionManager + introspect. Credentials are decrypted in memory here and
 * handed to the transport already-decrypted (§7.7) — the gateway never sees the
 * master key. Seed mocks (in-memory://) are not reachable over a real transport.
 */

const MOCK_PREFIX = "in-memory://";

export function isMockEndpoint(endpoint: string): boolean {
  return endpoint.startsWith(MOCK_PREFIX);
}

/** Build a connectable UpstreamSpec from a DB connection row + its decrypted cred. */
export function specFromConnection(conn: McpConnection): UpstreamSpec {
  const cred = conn.encryptedCreds ? decryptSecret(Buffer.from(conn.encryptedCreds)) : undefined;
  if (conn.transport === "HTTP") {
    return {
      id: conn.label,
      transport: "http",
      url: conn.endpoint,
      ...(cred ? { headers: { Authorization: `Bearer ${cred}` } } : {}),
    };
  }
  // STDIO: endpoint is JSON { command, args } (see UI hint). The cred, if any, is
  // exposed to the child as MCP_CREDENTIAL — the convention the demo expects.
  let parsed: { command?: string; args?: string[] };
  try {
    parsed = JSON.parse(conn.endpoint) as { command?: string; args?: string[] };
  } catch {
    throw new Error("STDIO endpoint must be JSON: { command, args }");
  }
  if (!parsed.command) throw new Error("STDIO endpoint is missing 'command'");
  return {
    id: conn.label,
    transport: "stdio",
    command: parsed.command,
    ...(parsed.args ? { args: parsed.args } : {}),
    ...(cred ? { env: { MCP_CREDENTIAL: cred } } : {}),
  };
}

/**
 * Connect to one upstream and return its typed catalog. Always closes the
 * transient session. Throws on connection/protocol failure (caller surfaces it).
 */
export async function introspectConnection(conn: McpConnection): Promise<TypedTool[]> {
  if (isMockEndpoint(conn.endpoint)) {
    throw new Error("in-memory mock connection is not introspectable");
  }
  const cm = new ConnectionManager();
  cm.register(specFromConnection(conn));
  try {
    const client = await cm.getClient(conn.label);
    return await introspect(client, conn.label, classifyEffect);
  } finally {
    await cm.closeAll();
  }
}

/** Serialize a TypedTool into the API/UI shape (params flattened, type as string). */
export function toCatalogJson(tools: readonly TypedTool[]): unknown {
  return tools.map((t) => ({
    name: t.name,
    ...(t.description ? { description: t.description } : {}),
    effect: t.effect,
    params: t.params.map((p) => ({
      name: p.name,
      type: formatType(p.type),
      required: p.required,
      ...(p.description ? { description: p.description } : {}),
    })),
  }));
}

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

/**
 * How to reach one upstream MCP server. Credentials/headers/env arrive ALREADY
 * decrypted from the caller (apps/server does the AES-GCM decrypt in memory,
 * §7.7) — the gateway never touches the DB or the master key.
 */
export type UpstreamSpec =
  | {
      readonly id: string;
      readonly transport: "stdio";
      readonly command: string;
      readonly args?: string[];
      readonly env?: Record<string, string>;
    }
  | {
      readonly id: string;
      readonly transport: "http";
      readonly url: string;
      readonly headers?: Record<string, string>;
    };

interface Entry {
  spec?: UpstreamSpec;
  /** A pre-connected client (in-memory / injected) that we never rebuild. */
  injected: boolean;
  client?: Client;
}

const CLIENT_INFO = { name: "ikarus-gateway", version: "0.0.0" } as const;

/**
 * Owns the live upstream MCP client sessions, keyed by mcp id. Lives in the
 * long-running server process (not serverless). Lazy-connects on first use and
 * transparently reconnects a dead session.
 */
export class ConnectionManager {
  private readonly entries = new Map<string, Entry>();
  /** In-flight connects, so concurrent getClient() calls share one connection. */
  private readonly connecting = new Map<string, Promise<Client>>();

  /** Register a connectable upstream (stdio/http). Connected lazily. */
  register(spec: UpstreamSpec): void {
    this.entries.set(spec.id, { spec, injected: false });
  }

  /** Register an already-connected client (in-memory transport / tests). */
  registerClient(id: string, client: Client): void {
    this.entries.set(id, { client, injected: true });
  }

  ids(): string[] {
    return [...this.entries.keys()];
  }

  async getClient(id: string): Promise<Client> {
    const entry = this.entries.get(id);
    if (!entry) throw new Error(`unknown upstream MCP '${id}'`);
    if (entry.client) return entry.client;
    if (entry.injected || !entry.spec) {
      throw new Error(`upstream MCP '${id}' has no live connection`);
    }
    const inflight = this.connecting.get(id);
    if (inflight) return inflight;
    const spec = entry.spec;
    const p = this.connect(spec)
      .then((client) => {
        entry.client = client;
        this.connecting.delete(id);
        return client;
      })
      .catch((err) => {
        this.connecting.delete(id);
        throw err;
      });
    this.connecting.set(id, p);
    return p;
  }

  /** Drop a dead session so the next getClient() reconnects (non-injected only). */
  async reset(id: string): Promise<void> {
    const entry = this.entries.get(id);
    if (!entry || entry.injected) return;
    const client = entry.client;
    entry.client = undefined;
    if (client) await client.close().catch(() => {});
  }

  async closeAll(): Promise<void> {
    await Promise.all(
      [...this.entries.values()].map((e) => (e.injected ? undefined : e.client?.close().catch(() => {}))),
    );
    for (const e of this.entries.values()) if (!e.injected) e.client = undefined;
  }

  private async connect(spec: UpstreamSpec): Promise<Client> {
    const transport: Transport =
      spec.transport === "stdio"
        ? new StdioClientTransport({
            command: spec.command,
            ...(spec.args ? { args: spec.args } : {}),
            ...(spec.env ? { env: spec.env } : {}),
          })
        : new StreamableHTTPClientTransport(new URL(spec.url), {
            ...(spec.headers ? { requestInit: { headers: spec.headers } } : {}),
          });
    const client = new Client(CLIENT_INFO);
    await client.connect(transport);
    return client;
  }
}

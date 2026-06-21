import { supabase } from "./supabase";

/** Shapes returned by the REST API (apps/server). Mirror, not import (no shared dep). */
export interface RedactedSecret {
  configured: boolean;
  last4: string | null;
}
export interface Connection {
  id: string;
  label: string;
  transport: "STDIO" | "HTTP";
  endpoint: string;
  status: string;
  credentials: RedactedSecret;
}
export interface PolicyRow {
  id: string;
  mcpId: string;
  toolName: string;
  effect: "READ" | "SINK";
  sensitiveArgs: string[];
  requireTrusted: boolean;
}
export interface CatalogParam {
  name: string;
  type: string;
  required: boolean;
  description?: string;
}
export interface CatalogTool {
  name: string;
  description?: string;
  effect: "read" | "sink";
  params: CatalogParam[];
}
export interface VerifyResult {
  status: string;
  toolCount?: number;
  mock?: boolean;
  error?: string;
}
export interface ModelRow {
  role: "PLANNER" | "QUARANTINE";
  provider: "ANTHROPIC" | "OPENAI";
  modelId: string;
  apiKey: RedactedSecret;
}

export type CapSnapshot = { provenance: string[]; trusted: boolean };
export type TracedArg = { preview: string; cap: CapSnapshot };
export interface TraceEvent {
  seq: number;
  kind: "plan" | "tool_call" | "query_ai" | "policy_deny" | "return" | "error";
  mcpId?: string;
  toolName?: string;
  args?: Record<string, TracedArg>;
  verdict?: "allow" | "deny";
  ruleId?: string;
  detail?: string;
}
export interface RunSummary {
  id: string;
  task: string;
  status: "completed" | "blocked" | "error";
  error: string | null;
  createdAt: string;
}
export interface RunDetail extends RunSummary {
  program: string | null;
  result: unknown;
  trace: TraceEvent[];
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function token(): Promise<string | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const jwt = await token();
  const res = await fetch(path, {
    method,
    headers: {
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...(jwt ? { authorization: `Bearer ${jwt}` } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new ApiError(res.status, (detail as { error?: string }).error ?? res.statusText);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

export const api = {
  connections: {
    list: () => request<Connection[]>("GET", "/api/connections"),
    create: (b: { label: string; transport: "STDIO" | "HTTP"; endpoint: string; credentials?: string }) =>
      request<{ id: string }>("POST", "/api/connections", b),
    update: (
      id: string,
      b: { label?: string; transport?: "STDIO" | "HTTP"; endpoint?: string; credentials?: string },
    ) => request<{ ok: true }>("PUT", `/api/connections/${id}`, b),
    remove: (id: string) => request<{ ok: true }>("DELETE", `/api/connections/${id}`),
    verify: (id: string) => request<VerifyResult>("POST", `/api/connections/${id}/verify`),
    catalog: (id: string) => request<CatalogTool[]>("GET", `/api/connections/${id}/catalog`),
  },
  policies: {
    list: () => request<PolicyRow[]>("GET", "/api/policies"),
    create: (b: {
      connectionId: string;
      toolName: string;
      effect: "READ" | "SINK";
      sensitiveArgs?: string[];
      requireTrusted?: boolean;
    }) => request<{ id: string }>("POST", "/api/policies", b),
    update: (id: string, b: Partial<Pick<PolicyRow, "effect" | "sensitiveArgs" | "requireTrusted">>) =>
      request<{ ok: true }>("PUT", `/api/policies/${id}`, b),
    remove: (id: string) => request<{ ok: true }>("DELETE", `/api/policies/${id}`),
  },
  models: {
    list: () => request<ModelRow[]>("GET", "/api/models"),
    save: (role: "PLANNER" | "QUARANTINE", b: { provider: "ANTHROPIC" | "OPENAI"; modelId: string; apiKey?: string }) =>
      request<{ ok: true }>("PUT", `/api/models/${role}`, b),
  },
  runs: {
    list: () => request<RunSummary[]>("GET", "/api/runs"),
    get: (id: string) => request<RunDetail>("GET", `/api/runs/${id}`),
  },
  mcpKey: {
    get: () => request<{ configured: boolean; last4: string | null }>("GET", "/api/mcp-key"),
    // The plaintext key is returned exactly once, on generation.
    generate: () => request<{ key: string; last4: string }>("POST", "/api/mcp-key"),
  },
};

/** The personal MCP endpoint URL (server origin, not the SPA). */
export const MCP_URL =
  (import.meta.env.VITE_MCP_URL as string | undefined) ?? "http://localhost:8787/mcp";

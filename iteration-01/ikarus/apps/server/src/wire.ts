import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Planner, PolicyRule, QuarantineClient, RunResult } from "@ikarus/shared";
import { ConnectionManager, GatewayToolProvider, type RunTaskDeps } from "@ikarus/gateway";
import { createInterpreter } from "@ikarus/interpreter";
import { DeclarativePolicyEngine, buildDefaultRules, classifyEffect } from "@ikarus/policy";
import { AiPlanner, AiQuarantine, modelFromConfig, type LlmProvider, type ModelConfig } from "@ikarus/llm";
import { createMailboxServer, createMailerServer, type MailerServer } from "./mock-upstream/servers.js";
import { StubPlanner, StubQuarantine } from "./stubs.js";

/** Link an in-process mock MCP server to the ConnectionManager (no child procs). */
async function link(cm: ConnectionManager, id: string, server: McpServer): Promise<void> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "ikarus-gateway", version: "0.0.0" });
  await client.connect(clientTransport);
  cm.registerClient(id, client);
}

/** Read an LLM model config from env (e.g. PLANNER_PROVIDER/MODEL/API_KEY). */
function modelEnv(prefix: string): ModelConfig | undefined {
  const provider = process.env[`${prefix}_PROVIDER`] as LlmProvider | undefined;
  const modelId = process.env[`${prefix}_MODEL`];
  const apiKey = process.env[`${prefix}_API_KEY`];
  if ((provider === "anthropic" || provider === "openai") && modelId && apiKey) {
    return { provider, modelId, apiKey };
  }
  return undefined;
}

export interface WiredSystem {
  deps: RunTaskDeps;
  cm: ConnectionManager;
  mailer: MailerServer;
  /** Whether the real LLM-backed planner/quarantine are in use (vs stubs). */
  usingRealLlm: { planner: boolean; quarantine: boolean };
}

export interface WireOptions {
  /**
   * Policy rules to seed the engine with. When omitted, default-secure rules are
   * derived from the live catalog (P3). The DB-backed path (P4) passes the user's
   * edited rules loaded from the DB.
   */
  policyRules?: readonly PolicyRule[];
  /** Decrypted model config for the Planner (overrides env). */
  plannerConfig?: ModelConfig;
  /** Decrypted model config for the Quarantine (overrides env). */
  quarantineConfig?: ModelConfig;
  /** Persistence hook fired with every finished run (P4 trace viewer). */
  onResult?: (task: string, result: RunResult) => void | Promise<void>;
}

/**
 * Wire the demo system: in-memory mock upstreams (mailbox + mailer) behind the
 * real aggregator/interpreter, the real declarative policy engine, and the real
 * Planner/Quarantine.
 *
 * Config precedence for each piece: explicit `opts` (DB-backed, per §7.6/§7.7) →
 * env vars → stub. This lets the spine run with zero config while the DB path
 * supplies per-user, decrypted credentials and DB-loaded policy rules.
 */
export async function wireDemoSystem(opts: WireOptions = {}): Promise<WiredSystem> {
  const cm = new ConnectionManager();
  await link(cm, "mailbox", createMailboxServer());
  const mailer = createMailerServer();
  await link(cm, "mailer", mailer.server);
  const { deps, usingRealLlm } = await assembleSystem(cm, opts);
  return { deps, cm, mailer, usingRealLlm };
}

/**
 * Assemble RunTaskDeps over an already-populated ConnectionManager (mocks or real
 * upstreams). Config precedence per piece: explicit `opts` (DB-backed) → env → stub.
 * Shared by the demo spine and the per-user MCP workspace.
 */
export async function assembleSystem(
  cm: ConnectionManager,
  opts: WireOptions = {},
): Promise<{ deps: RunTaskDeps; usingRealLlm: { planner: boolean; quarantine: boolean } }> {
  // Inject P3's authoritative effect classifier into the gateway (single source).
  const tools = new GatewayToolProvider(cm, classifyEffect);
  const rules = opts.policyRules ?? buildDefaultRules(await tools.catalog());
  const policy = new DeclarativePolicyEngine(rules);

  const plannerCfg = opts.plannerConfig ?? modelEnv("PLANNER");
  const quarantineCfg = opts.quarantineConfig ?? modelEnv("QUARANTINE");
  const planner: Planner = plannerCfg ? new AiPlanner(modelFromConfig(plannerCfg)) : new StubPlanner();
  const quarantine: QuarantineClient = quarantineCfg
    ? new AiQuarantine(modelFromConfig(quarantineCfg))
    : new StubQuarantine();

  const deps: RunTaskDeps = {
    planner,
    interpreter: createInterpreter(),
    tools,
    quarantine,
    policy,
    ...(opts.onResult ? { onResult: opts.onResult } : {}),
  };

  return { deps, usingRealLlm: { planner: Boolean(plannerCfg), quarantine: Boolean(quarantineCfg) } };
}

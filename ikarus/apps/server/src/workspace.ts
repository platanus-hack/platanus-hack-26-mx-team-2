import { ConnectionManager, type RunTaskDeps } from "@ikarus/gateway";
import { assembleSystem, type WireOptions } from "./wire.js";
import { db, hasDatabase } from "./db.js";
import { loadModelConfig, loadPolicyRules } from "./store/config-store.js";
import { PrismaRunStore } from "./store/run-store.js";
import { isMockEndpoint, specFromConnection } from "./store/catalog.js";

/**
 * Resolve the MCP workspace's runtime config from the DB (P4 boundary notes):
 *  - policy rules loaded from the DB (falls back to default-secure if none),
 *  - Planner/Quarantine model configs decrypted from the DB (else env/stub),
 *  - run+trace persistence via the Prisma store.
 *
 * The MCP `run_task` surface is not per-user-authenticated in the demo, so the
 * workspace user is taken from IKARUS_WORKSPACE_USER. Without a DB (or that env),
 * returns empty options → the offline demo spine.
 */
export async function resolveWorkspaceOptions(): Promise<WireOptions> {
  const userId = process.env.IKARUS_WORKSPACE_USER;
  if (!hasDatabase() || !userId) return {};

  const store = new PrismaRunStore();
  try {
    const [rules, plannerCfg, quarantineCfg] = await Promise.all([
      loadPolicyRules(userId),
      loadModelConfig(userId, "PLANNER"),
      loadModelConfig(userId, "QUARANTINE"),
    ]);

    return {
      ...(rules.length > 0 ? { policyRules: rules } : {}),
      ...(plannerCfg ? { plannerConfig: plannerCfg } : {}),
      ...(quarantineCfg ? { quarantineConfig: quarantineCfg } : {}),
      onResult: (task, result) => store.save(userId, task, result).then(() => undefined),
    };
  } catch (err) {
    // The DB is configured but unreachable. Don't take the MCP endpoint down with
    // it — degrade to the offline demo spine and log loudly.
    console.error("workspace config load failed; running offline demo spine:", err);
    return {};
  }
}

export interface UserSystem {
  deps: RunTaskDeps;
  cm: ConnectionManager;
}

/**
 * Build a per-user MCP workspace: a ConnectionManager over the user's REAL DB
 * connections (mocks are skipped — not reachable over a transport), plus their
 * DB-loaded policy rules and decrypted model configs, with run persistence.
 * Resolved lazily by the MCP endpoint after the personal key authenticates.
 */
export async function buildUserWiredSystem(userId: string): Promise<UserSystem> {
  const connections = await db().mcpConnection.findMany({ where: { userId } });
  const cm = new ConnectionManager();
  for (const c of connections) {
    if (isMockEndpoint(c.endpoint)) continue;
    try {
      cm.register(specFromConnection(c));
    } catch (err) {
      console.warn(`[mcp] skipping connection '${c.label}': ${(err as Error).message}`);
    }
  }

  const store = new PrismaRunStore();
  const [rules, plannerCfg, quarantineCfg] = await Promise.all([
    loadPolicyRules(userId),
    loadModelConfig(userId, "PLANNER"),
    loadModelConfig(userId, "QUARANTINE"),
  ]);

  const opts: WireOptions = {
    ...(rules.length > 0 ? { policyRules: rules } : {}),
    ...(plannerCfg ? { plannerConfig: plannerCfg } : {}),
    ...(quarantineCfg ? { quarantineConfig: quarantineCfg } : {}),
    onResult: (task, result) => store.save(userId, task, result).then(() => undefined),
  };

  const { deps } = await assembleSystem(cm, opts);
  return { deps, cm };
}

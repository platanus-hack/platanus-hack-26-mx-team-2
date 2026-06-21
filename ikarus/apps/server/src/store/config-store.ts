import type { PolicyRule } from "@ikarus/shared";
import type { ModelConfig, LlmProvider } from "@ikarus/llm";
import { db } from "../db.js";
import { decryptSecret } from "../crypto.js";

/**
 * Resolve a user's runtime config from the DB, honoring P3's boundary notes:
 *  - PolicyRule[] come from the DB (not buildDefaultRules) — the engine is seeded
 *    with the user's edited rules; the runtime mcpId is the connection's label.
 *  - ModelConfig is reconstructed from the stored, encrypted key, decrypted in
 *    memory here (§7.7). The plaintext key never leaves this process.
 */

const PROVIDER: Record<string, LlmProvider> = { ANTHROPIC: "anthropic", OPENAI: "openai" };

/** Load the user's policy rules, keyed by connection label as the runtime mcpId. */
export async function loadPolicyRules(userId: string): Promise<PolicyRule[]> {
  const rows = await db().policy.findMany({
    where: { userId },
    include: { connection: { select: { label: true } } },
  });
  return rows.map((p) => ({
    id: p.id,
    mcpId: p.connection.label,
    toolName: p.toolName,
    effect: p.effect === "SINK" ? "sink" : "read",
    sensitiveArgs: p.sensitiveArgs,
    requireTrusted: p.requireTrusted,
  }));
}

/** Load + decrypt a user's model config for a role, or null if not configured. */
export async function loadModelConfig(
  userId: string,
  role: "PLANNER" | "QUARANTINE",
): Promise<ModelConfig | null> {
  const row = await db().modelConfig.findUnique({ where: { userId_role: { userId, role } } });
  if (!row) return null;
  const provider = PROVIDER[row.provider];
  if (!provider) return null;
  const apiKey = decryptSecret(Buffer.from(row.encryptedKey));
  // An empty key means "not really configured" — don't build a broken client.
  if (!apiKey) return null;
  return { provider, modelId: row.modelId, apiKey };
}

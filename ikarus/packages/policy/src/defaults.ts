import type { PolicyRule, TypedTool } from "@ikarus/shared";
import { classifyEffect } from "./effect-classifier.js";

/**
 * Derive a starting, default-secure rule set from a catalog — one rule per tool,
 * for the UI to display and edit (P4). Sinks default to "all args sensitive,
 * must be trusted"; reads to no requirement. The engine is already default-secure
 * without these, so they are a configuration seed, not a security dependency.
 */
export function buildDefaultRules(catalog: readonly TypedTool[]): PolicyRule[] {
  return catalog.map((t) => {
    // ONE authoritative effect, used consistently. The catalog's `t.effect` is
    // already resolved by the injected classifier (annotations → verb → sink);
    // only fall back to the name heuristic if it is somehow missing. Deriving it
    // twice (once for `effect`, once from the name for the rest) could otherwise
    // emit a self-contradictory rule — e.g. a sink with requireTrusted=false —
    // and these rules ARE loaded into the live engine, so that would be a hole.
    const effect = t.effect ?? classifyEffect({ name: t.name });
    return {
      id: `${t.mcpId}.${t.name}:default`,
      mcpId: t.mcpId,
      toolName: t.name,
      effect,
      sensitiveArgs: effect === "sink" ? t.params.map((p) => p.name) : [],
      requireTrusted: effect === "sink",
    };
  });
}

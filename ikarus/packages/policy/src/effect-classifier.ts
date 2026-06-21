import type { ToolEffect } from "@ikarus/shared";

/**
 * AUTHORITATIVE read/sink classification (§12). The gateway carries a provisional
 * default at catalog-build time; this is the canonical implementation, injected
 * into the gateway (see apps/server wiring) so there is a single source of truth.
 * The UI/policy rules can still override per tool.
 *
 * Structurally compatible with the gateway's `EffectClassifier` type, so it can
 * be injected without a cross-package dependency.
 */
export interface ClassifiableTool {
  name: string;
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean };
}

const READ_VERBS = [
  "list",
  "get",
  "read",
  "search",
  "find",
  "fetch",
  "query",
  "show",
  "view",
  "describe",
  "lookup",
  "count",
];

function looksReadOnly(name: string): boolean {
  const lower = name.toLowerCase();
  return READ_VERBS.some((v) => lower === v || lower.startsWith(`${v}_`) || lower.startsWith(v));
}

/** Priority: explicit MCP annotations → name heuristic → conservative default (sink). */
export function classifyEffect(tool: ClassifiableTool): ToolEffect {
  const a = tool.annotations;
  if (a?.readOnlyHint === true) return "read";
  if (a?.destructiveHint === true) return "sink";
  if (looksReadOnly(tool.name)) return "read";
  return "sink";
}

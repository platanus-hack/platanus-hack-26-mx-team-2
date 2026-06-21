import type { ToolEffect } from "@ikarus/shared";

export interface ToolAnnotationsLike {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
}

export interface ClassifiableTool {
  name: string;
  annotations?: ToolAnnotationsLike;
}

/** Classifies a tool's effect (read vs sink). */
export type EffectClassifier = (tool: ClassifiableTool) => ToolEffect;

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
];

function looksReadOnly(name: string): boolean {
  const lower = name.toLowerCase();
  return READ_VERBS.some((v) => lower === v || lower.startsWith(`${v}_`) || lower.startsWith(v));
}

/**
 * PROVISIONAL effect classifier (§12 open question). The authoritative
 * read/sink classification and its overrides belong to the policy layer / UI
 * (P3, P4); this only produces a sensible default at catalog-build time.
 *
 * Priority: explicit MCP annotations → name heuristic → conservative default
 * (sink). Defaulting unknown tools to `sink` is the safe choice — a sink with
 * untrusted args is denied, never silently executed.
 */
export const defaultEffectClassifier: EffectClassifier = (tool) => {
  const a = tool.annotations;
  if (a?.readOnlyHint === true) return "read";
  if (a?.destructiveHint === true) return "sink";
  if (looksReadOnly(tool.name)) return "read";
  return "sink";
};

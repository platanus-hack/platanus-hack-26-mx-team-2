import type { PolicyDecision, PolicyEngine, PolicyRule, ToolCallContext } from "@ikarus/shared";

const key = (mcpId: string, tool: string): string => `${mcpId}.${tool}`;

/**
 * Declarative policy engine (§7.10). Rules come from the UI/DB (P4). The
 * vocabulary per tool: `<tool> : <effect> → <sensitiveArgs> must be trusted`,
 * resolving to allow/deny.
 *
 * Default-secure when NO rule matches a sink: ALL arguments are treated as
 * sensitive and must be trusted (§6.4, §10) — a sink fed any untrusted argument
 * is denied, never silently executed. Reads are always allowed (no effect); an
 * explicit rule may override a tool's effect or narrow its sensitive args.
 */
export class DeclarativePolicyEngine implements PolicyEngine {
  private readonly byKey: Map<string, PolicyRule>;

  constructor(rules: readonly PolicyRule[] = []) {
    this.byKey = new Map(rules.map((r) => [key(r.mcpId, r.toolName), r]));
  }

  check(ctx: ToolCallContext): PolicyDecision {
    const rule = this.byKey.get(key(ctx.mcpId, ctx.tool));
    const effect = rule?.effect ?? ctx.effect;

    if (effect === "read") {
      return { verdict: "allow", reason: "read tool (no external effect)" };
    }

    const ruleId = rule?.id ?? `${ctx.mcpId}.${ctx.tool}:default-secure`;
    const requireTrusted = rule?.requireTrusted ?? true;
    if (!requireTrusted) {
      return { verdict: "allow", ruleId, reason: `sink '${ctx.tool}' explicitly permits untrusted args` };
    }

    // Which args must be trusted: the rule's list, or — with no rule — ALL of them.
    const sensitive = rule ? new Set(rule.sensitiveArgs) : new Set(ctx.args.map((a) => a.name));
    const tainted = ctx.args.filter((a) => sensitive.has(a.name) && !a.cap.trusted);

    if (tainted.length > 0) {
      return {
        verdict: "deny",
        ruleId,
        reason: `sink '${ctx.tool}' received untrusted argument(s): ${tainted.map((a) => a.name).join(", ")}`,
      };
    }
    return { verdict: "allow", ruleId, reason: "all sensitive args are trusted" };
  }
}

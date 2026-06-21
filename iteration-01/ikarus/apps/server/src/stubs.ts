import type {
  Planner,
  PlanResult,
  PolicyEngine,
  QuarantineClient,
  QuarantineRequest,
  ToolCallContext,
  TypedTool,
} from "@ikarus/shared";

/* ─────────────────────────────────────────────────────────────────────────
 * TEMPORARY P3 STUBS. These exist only to run the M1 end-to-end spine before
 * @ikarus/llm (Planner, Quarantine) and @ikarus/policy land. Replace wholesale.
 * ───────────────────────────────────────────────────────────────────────── */

const SUMMARIZE_PLAN = `emails = mailbox.list_recent(n=10)
resumen = query_ai(emails, "resume estos correos en 5 bullets", output_type=str)
return resumen`;

// A plan that legitimately routes an extracted (untrusted) address into a sink,
// so the policy block is demonstrable. The real Planner produces this from a
// task like "reply to / forward the latest email".
const REPLY_PLAN = `emails = mailbox.list_recent(n=10)
addr = query_ai(emails, "extract the forwarding address", output_type=str)
sent = mailer.send_email(to=addr, body="forwarded as requested")
return sent`;

export class StubPlanner implements Planner {
  async plan(task: string, _catalog: readonly TypedTool[]): Promise<PlanResult> {
    void _catalog;
    const t = task.toLowerCase();
    const wantsSend = /reply|respond|responde|forward|reenv|send|env[ií]a/.test(t);
    return { source: wantsSend ? REPLY_PLAN : SUMMARIZE_PLAN };
  }
  async repair(
    task: string,
    catalog: readonly TypedTool[],
    _previous: string,
    _error: string,
  ): Promise<PlanResult> {
    void _previous;
    void _error;
    return this.plan(task, catalog);
  }
}

export class StubQuarantine implements QuarantineClient {
  async query(req: QuarantineRequest): Promise<unknown> {
    const instr = req.instruction.toLowerCase();
    if (/\bextract\b|forwarding|recipient|destinatario/.test(instr)) {
      // Fooled by the injection, it extracts the attacker address — which the
      // policy then blocks because the value is untrusted.
      return "attacker@evil.com";
    }
    const count = Array.isArray(req.source) ? req.source.length : 1;
    return `Resumen simulado de ${count} correos (Quarantine stub).`;
  }
}

/** Default-secure policy (§7.10): reads allowed; a sink with any untrusted arg
 *  is denied. Replaced by @ikarus/policy (declarative + UI-configurable). */
export class StubPolicy implements PolicyEngine {
  check(ctx: ToolCallContext) {
    if (ctx.effect === "read") {
      return { verdict: "allow" as const, reason: "read tool (no external effect)" };
    }
    const tainted = ctx.args.filter((a) => !a.cap.trusted);
    if (tainted.length > 0) {
      return {
        verdict: "deny" as const,
        ruleId: `${ctx.mcpId}.${ctx.tool}:require-trusted`,
        reason: `sink '${ctx.tool}' received untrusted argument(s): ${tainted.map((a) => a.name).join(", ")}`,
      };
    }
    return { verdict: "allow" as const, reason: "all sensitive args are trusted" };
  }
}

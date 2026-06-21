import {
  type Expr,
  type InterpreterDeps,
  type Program,
  type RunResult,
  type ToolEffect,
  type TraceEvent,
  type TracedArg,
  type TypedTool,
  snapshotCapability,
} from "@ikarus/shared";
import { type TaggedValue, preview, tag } from "./values.js";
import { joinCaps, quarantineCap, toolResultCap, userTrusted } from "./capabilities.js";
import { runtimeError } from "./errors.js";

/** Thrown when the policy denies a tool call; caught by `evaluate` → blocked. */
class PolicyBlock extends Error {
  constructor(
    message: string,
    readonly ruleId: string | undefined,
  ) {
    super(message);
    this.name = "PolicyBlock";
  }
}

const toolKey = (mcpId: string, tool: string): string => `${mcpId}.${tool}`;

class Evaluator {
  private readonly env = new Map<string, TaggedValue>();
  private readonly trace: TraceEvent[] = [];
  private seq = 0;
  private readonly catalogByKey: Map<string, TypedTool>;

  constructor(
    private readonly deps: InterpreterDeps,
    catalog: readonly TypedTool[],
  ) {
    this.catalogByKey = new Map(catalog.map((t) => [toolKey(t.mcpId, t.name), t]));
  }

  private emit(ev: Omit<TraceEvent, "seq">): void {
    this.trace.push({ seq: this.seq++, ...ev });
  }

  private effectOf(mcpId: string, tool: string): ToolEffect {
    // §12: unknown effect ⇒ conservative default = sink.
    return this.catalogByKey.get(toolKey(mcpId, tool))?.effect ?? "sink";
  }

  async run(program: Program): Promise<RunResult> {
    try {
      let returnValue: TaggedValue | undefined;
      for (const stmt of program.statements) {
        if (stmt.kind === "assign") {
          this.env.set(stmt.name, await this.evalExpr(stmt.value));
        } else {
          returnValue = await this.evalExpr(stmt.value);
          this.emit({
            kind: "return",
            detail: preview(returnValue.value),
            args: { value: this.tracedArg(returnValue) },
          });
          break;
        }
      }
      return {
        status: "completed",
        result: returnValue?.value ?? null,
        resultCap: snapshotCapability(returnValue?.cap ?? userTrusted()),
        trace: this.trace,
      };
    } catch (err) {
      if (err instanceof PolicyBlock) {
        return { status: "blocked", error: err.message, trace: this.trace };
      }
      const message = err instanceof Error ? err.message : String(err);
      this.emit({ kind: "error", detail: message });
      return { status: "error", error: message, trace: this.trace };
    }
  }

  private tracedArg(v: TaggedValue): TracedArg {
    return { preview: preview(v.value), cap: snapshotCapability(v.cap) };
  }

  private async evalExpr(expr: Expr): Promise<TaggedValue> {
    switch (expr.kind) {
      case "strLit":
        return tag(expr.value, userTrusted());
      case "numLit":
        return tag(expr.value, userTrusted());
      case "boolLit":
        return tag(expr.value, userTrusted());
      case "nullLit":
        return tag(null, userTrusted());
      case "var": {
        const v = this.env.get(expr.name);
        if (!v) throw runtimeError(`undefined variable '${expr.name}'`, expr.loc);
        return v;
      }
      case "listLit": {
        // Sequential on purpose: items may be tool calls with side effects.
        // Concurrency here would make effect order and trace seq nondeterministic.
        const values: unknown[] = [];
        const caps = [];
        for (const it of expr.items) {
          const v = await this.evalExpr(it);
          values.push(v.value);
          caps.push(v.cap);
        }
        return tag(values, joinCaps(caps));
      }
      case "dictLit": {
        const obj: Record<string, unknown> = {};
        const caps = [];
        for (const e of expr.entries) {
          const v = await this.evalExpr(e.value);
          obj[e.key] = v.value;
          caps.push(v.cap);
        }
        return tag(obj, joinCaps(caps));
      }
      case "member": {
        const obj = await this.evalExpr(expr.object);
        const value =
          obj.value != null && typeof obj.value === "object"
            ? (obj.value as Record<string, unknown>)[expr.field]
            : undefined;
        // §12: field access inherits the object's capability unchanged.
        return tag(value, obj.cap);
      }
      case "index": {
        const obj = await this.evalExpr(expr.object);
        const idx = await this.evalExpr(expr.index);
        const key = idx.value as string | number;
        const value =
          obj.value != null && typeof obj.value === "object"
            ? (obj.value as Record<string | number, unknown>)[key]
            : undefined;
        return tag(value, joinCaps([obj.cap, idx.cap]));
      }
      case "toolCall":
        return this.evalToolCall(expr);
      case "queryAi":
        return this.evalQueryAi(expr);
    }
  }

  private async evalToolCall(expr: Extract<Expr, { kind: "toolCall" }>): Promise<TaggedValue> {
    const effect = this.effectOf(expr.mcpId, expr.tool);
    const rawArgs: Record<string, unknown> = {};
    const tracedArgs: Record<string, TracedArg> = {};
    const policyArgs = [];
    for (const a of expr.args) {
      const v = await this.evalExpr(a.value);
      rawArgs[a.name] = v.value;
      tracedArgs[a.name] = this.tracedArg(v);
      policyArgs.push({ name: a.name, cap: snapshotCapability(v.cap) });
    }

    const decision = this.deps.policy.check({
      mcpId: expr.mcpId,
      tool: expr.tool,
      effect,
      args: policyArgs,
    });

    this.emit({
      kind: decision.verdict === "deny" ? "policy_deny" : "tool_call",
      mcpId: expr.mcpId,
      toolName: expr.tool,
      args: tracedArgs,
      verdict: decision.verdict,
      ...(decision.ruleId ? { ruleId: decision.ruleId } : {}),
      detail: decision.reason,
    });

    if (decision.verdict === "deny") {
      throw new PolicyBlock(
        `policy blocked ${expr.mcpId}.${expr.tool}: ${decision.reason}`,
        decision.ruleId,
      );
    }

    const result = await this.deps.tools.invoke(expr.mcpId, expr.tool, rawArgs);
    return tag(result, toolResultCap(expr.mcpId));
  }

  private async evalQueryAi(expr: Extract<Expr, { kind: "queryAi" }>): Promise<TaggedValue> {
    const source = await this.evalExpr(expr.source);
    const result = await this.deps.quarantine.query({
      source: source.value,
      instruction: expr.instruction,
      outputType: expr.outputType,
    });
    this.emit({
      kind: "query_ai",
      args: { source: this.tracedArg(source) },
      detail: expr.instruction,
    });
    // ALWAYS untrusted, regardless of inputs.
    return tag(result, quarantineCap(source.cap));
  }
}

export async function evaluate(
  program: Program,
  deps: InterpreterDeps,
  catalog: readonly TypedTool[],
): Promise<RunResult> {
  return new Evaluator(deps, catalog).run(program);
}

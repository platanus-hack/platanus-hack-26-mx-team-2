import { Prisma } from "@prisma/client";
import type { RunResult, RunStatus, TraceEvent } from "@ikarus/shared";
import { db } from "../db.js";

/** A persisted run as returned to the UI. Never contains raw secrets. */
export interface PersistedRun {
  readonly id: string;
  readonly task: string;
  readonly program: string | null;
  readonly status: RunStatus;
  readonly result: unknown;
  readonly error: string | null;
  readonly createdAt: string;
  readonly trace: readonly TraceEvent[];
}

export type RunSummary = Omit<PersistedRun, "trace" | "result" | "program">;

export interface RunStore {
  save(userId: string, task: string, result: RunResult): Promise<string>;
  list(userId: string): Promise<RunSummary[]>;
  get(userId: string, runId: string): Promise<PersistedRun | null>;
}

const DB_STATUS: Record<RunStatus, "COMPLETED" | "BLOCKED" | "ERROR"> = {
  completed: "COMPLETED",
  blocked: "BLOCKED",
  error: "ERROR",
};
const FROM_DB: Record<string, RunStatus> = {
  COMPLETED: "completed",
  BLOCKED: "blocked",
  ERROR: "error",
  PLANNING: "error",
  RUNNING: "error",
};

/** In-memory store for tests and the offline demo (no DATABASE_URL). */
export class InMemoryRunStore implements RunStore {
  private readonly runs: PersistedRun[] = [];
  private seq = 0;

  async save(userId: string, task: string, result: RunResult): Promise<string> {
    const id = `run_${++this.seq}`;
    // userId is kept implicitly: the in-memory store is single-workspace.
    void userId;
    this.runs.unshift({
      id,
      task,
      program: result.program ?? null,
      status: result.status,
      result: result.result ?? null,
      error: result.error ?? null,
      createdAt: new Date(0).toISOString(),
      trace: result.trace,
    });
    return id;
  }

  async list(): Promise<RunSummary[]> {
    return this.runs.map(({ trace: _t, result: _r, program: _p, ...s }) => s);
  }

  async get(_userId: string, runId: string): Promise<PersistedRun | null> {
    return this.runs.find((r) => r.id === runId) ?? null;
  }
}

/**
 * Prisma-backed store. The trace is already secret-scrubbed by the interpreter
 * (TracedArg.preview is truncated + scrubbed), so we persist it as-is; we never
 * write credentials or API keys here.
 */
export class PrismaRunStore implements RunStore {
  async save(userId: string, task: string, result: RunResult): Promise<string> {
    const run = await db().run.create({
      data: {
        userId,
        task,
        program: result.program ?? null,
        status: DB_STATUS[result.status],
        result: result.result == null ? Prisma.JsonNull : (result.result as Prisma.InputJsonValue),
        error: result.error ?? null,
        traces: {
          create: result.trace.map((e) => ({
            seq: e.seq,
            kind: e.kind,
            mcpId: e.mcpId ?? null,
            toolName: e.toolName ?? null,
            argCaps: (e.args ?? {}) as unknown as Prisma.InputJsonValue,
            verdict: e.verdict ?? null,
            ruleId: e.ruleId ?? null,
            detail: e.detail ? { text: e.detail } : Prisma.JsonNull,
          })),
        },
      },
    });
    return run.id;
  }

  async list(userId: string): Promise<RunSummary[]> {
    const runs = await db().run.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      select: { id: true, task: true, status: true, error: true, createdAt: true },
    });
    return runs.map((r) => ({
      id: r.id,
      task: r.task,
      status: FROM_DB[r.status] ?? "error",
      error: r.error,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  async get(userId: string, runId: string): Promise<PersistedRun | null> {
    const run = await db().run.findFirst({
      where: { id: runId, userId },
      include: { traces: { orderBy: { seq: "asc" } } },
    });
    if (!run) return null;
    return {
      id: run.id,
      task: run.task,
      program: run.program,
      status: FROM_DB[run.status] ?? "error",
      result: run.result,
      error: run.error,
      createdAt: run.createdAt.toISOString(),
      trace: run.traces.map((t) => ({
        seq: t.seq,
        kind: t.kind as TraceEvent["kind"],
        ...(t.mcpId ? { mcpId: t.mcpId } : {}),
        ...(t.toolName ? { toolName: t.toolName } : {}),
        ...(t.argCaps ? { args: t.argCaps as unknown as TraceEvent["args"] } : {}),
        ...(t.verdict ? { verdict: t.verdict as TraceEvent["verdict"] } : {}),
        ...(t.ruleId ? { ruleId: t.ruleId } : {}),
        ...(t.detail ? { detail: (t.detail as { text?: string }).text ?? "" } : {}),
      })),
    };
  }
}

import type { Loc } from "@ikarus/shared";

export type Phase = "lex" | "parse" | "semantic" | "runtime";

/**
 * All interpreter errors. Errors from "lex" | "parse" | "semantic" are TRUSTED
 * (produced by our own code over the trusted plan, never from untrusted data),
 * so they may be fed back to the Planner repair loop (§7.3).
 */
export class LplError extends Error {
  readonly phase: Phase;
  readonly loc?: Loc;

  constructor(phase: Phase, message: string, loc?: Loc) {
    const where = loc ? ` (line ${loc.line}, col ${loc.col})` : "";
    super(`[${phase}]${where} ${message}`);
    this.name = "LplError";
    this.phase = phase;
    if (loc) this.loc = loc;
  }
}

export const lexError = (msg: string, loc: Loc): LplError => new LplError("lex", msg, loc);
export const parseError = (msg: string, loc: Loc): LplError => new LplError("parse", msg, loc);
export const semanticError = (msg: string, loc?: Loc): LplError => new LplError("semantic", msg, loc);
export const runtimeError = (msg: string, loc?: Loc): LplError => new LplError("runtime", msg, loc);

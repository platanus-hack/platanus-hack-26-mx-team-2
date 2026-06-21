import type { Interpreter, InterpreterDeps, Program, RunResult, TypedTool } from "@ikarus/shared";
import { parse } from "./parser.js";
import { check } from "./semantics.js";
import { evaluate } from "./evaluator.js";
import { LplError } from "./errors.js";

export { lex } from "./lexer.js";
export { parse } from "./parser.js";
export { check } from "./semantics.js";
export { evaluate } from "./evaluator.js";
export { joinCaps, userTrusted, toolResultCap, quarantineCap } from "./capabilities.js";
export { LplError } from "./errors.js";
export type { Phase } from "./errors.js";
export type { TaggedValue } from "./values.js";
export type { RawProgram, RawExpr, RawStmt } from "./raw-ast.js";
export type { Token } from "./tokens.js";

/**
 * Compile LPL source into a checked Program (lex → parse → semantic check).
 * Throws a TRUSTED `LplError` on any failure — feed its `.message` to the
 * Planner repair loop (§7.3).
 */
export function compile(source: string, catalog: readonly TypedTool[] = []): Program {
  return check(parse(source), catalog);
}

export class IkarusInterpreter implements Interpreter {
  async run(source: string, deps: InterpreterDeps): Promise<RunResult> {
    const catalog = await deps.tools.catalog();
    let program: Program;
    try {
      program = compile(source, catalog);
    } catch (err) {
      if (err instanceof LplError) {
        return { status: "error", error: err.message, program: source, trace: [] };
      }
      throw err;
    }
    const result = await evaluate(program, deps, catalog);
    return { ...result, program: source };
  }
}

export const createInterpreter = (): Interpreter => new IkarusInterpreter();

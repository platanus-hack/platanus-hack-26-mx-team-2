import { generateObject, type LanguageModel } from "ai";
import { z } from "zod";
import type { Planner, PlanResult, TypedTool } from "@ikarus/shared";
import { plannerSystemPrompt, repairUserPrompt, taskUserPrompt } from "./planner-prompt.js";

const PlanSchema = z.object({
  program: z.string().describe("The complete LPL program text."),
});

export interface AiPlannerOptions {
  /** Low temperature → deterministic plans (default 0). */
  temperature?: number;
  maxRetries?: number;
}

/**
 * The internal Planner (§7.1): a TRUSTED LLM that turns the user's complete task
 * into an LPL program, BEFORE any untrusted data is read. Uses structured output
 * so we reliably get program text (no markdown fences). Validity is enforced
 * downstream by the interpreter's compiler + repair loop (§7.3).
 */
export class AiPlanner implements Planner {
  constructor(
    private readonly model: LanguageModel,
    private readonly opts: AiPlannerOptions = {},
  ) {}

  async plan(task: string, catalog: readonly TypedTool[]): Promise<PlanResult> {
    const { object } = await generateObject({
      model: this.model,
      schema: PlanSchema,
      system: plannerSystemPrompt(catalog),
      prompt: taskUserPrompt(task),
      temperature: this.opts.temperature ?? 0,
      maxRetries: this.opts.maxRetries ?? 2,
    });
    return { source: object.program };
  }

  async repair(
    task: string,
    catalog: readonly TypedTool[],
    previous: string,
    error: string,
  ): Promise<PlanResult> {
    const { object } = await generateObject({
      model: this.model,
      schema: PlanSchema,
      system: plannerSystemPrompt(catalog),
      prompt: repairUserPrompt(task, previous, error),
      temperature: this.opts.temperature ?? 0,
      maxRetries: this.opts.maxRetries ?? 2,
    });
    return { source: object.program };
  }
}

import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";

export type LlmProvider = "anthropic" | "openai";

/** User-supplied model configuration (model id + API key), per §7.6/§7.7. */
export interface ModelConfig {
  provider: LlmProvider;
  modelId: string;
  apiKey: string;
}

/**
 * Build an AI SDK LanguageModel from a user's stored config. The key is decrypted
 * in memory by the caller (apps/server, §7.7) and passed here — this module never
 * touches the DB or the master key.
 */
export function modelFromConfig(cfg: ModelConfig): LanguageModel {
  switch (cfg.provider) {
    case "anthropic":
      return createAnthropic({ apiKey: cfg.apiKey })(cfg.modelId);
    case "openai":
      return createOpenAI({ apiKey: cfg.apiKey })(cfg.modelId);
  }
}

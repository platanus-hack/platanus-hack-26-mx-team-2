import type { TypeRef } from "../types/type-ref.js";

export interface QuarantineRequest {
  /** The untrusted data to parse (already extracted from a tool result). */
  readonly source: unknown;
  /** The trusted instruction telling the model what to extract. */
  readonly instruction: string;
  /** The required typed shape of the output. */
  readonly outputType: TypeRef;
}

/**
 * The quarantined LLM (§6.5): no tools, no shared state, NO caching (§7.6).
 * It only parses untrusted data into a typed value. Its output is ALWAYS
 * untrusted regardless of input. Implemented by @ikarus/llm.
 */
export interface QuarantineClient {
  query(req: QuarantineRequest): Promise<unknown>;
}

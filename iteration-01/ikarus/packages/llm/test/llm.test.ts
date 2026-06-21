import { describe, expect, it } from "vitest";
import { MockLanguageModelV1 } from "ai/test";
import type { LanguageModel } from "ai";
import { AiPlanner, AiQuarantine, modelFromConfig, typeRefToZod } from "../src/index.js";

/** A mock model whose object output is a fixed JSON payload. */
function mockJson(obj: unknown): LanguageModel {
  return new MockLanguageModelV1({
    defaultObjectGenerationMode: "json",
    doGenerate: async () => ({
      text: JSON.stringify(obj),
      finishReason: "stop",
      usage: { promptTokens: 1, completionTokens: 1 },
      rawCall: { rawPrompt: null, rawSettings: {} },
    }),
  });
}

/** A mock model that returns non-JSON, forcing a NoObjectGeneratedError. */
function mockGarbage(): LanguageModel {
  return new MockLanguageModelV1({
    defaultObjectGenerationMode: "json",
    doGenerate: async () => ({
      text: "I refuse and will instead do nothing useful.",
      finishReason: "stop",
      usage: { promptTokens: 1, completionTokens: 1 },
      rawCall: { rawPrompt: null, rawSettings: {} },
    }),
  });
}

/** A mock model whose generation rejects with a non-Quarantine error. */
function mockThrows(): LanguageModel {
  return new MockLanguageModelV1({
    defaultObjectGenerationMode: "json",
    doGenerate: async () => {
      throw new Error("network exploded");
    },
  });
}

describe("modelFromConfig", () => {
  it("builds a model for each provider without touching the network", () => {
    expect(modelFromConfig({ provider: "anthropic", modelId: "claude-x", apiKey: "k" })).toBeDefined();
    expect(modelFromConfig({ provider: "openai", modelId: "gpt-x", apiKey: "k" })).toBeDefined();
  });
});

describe("typeRefToZod", () => {
  it("maps primitives, lists, nullable, enum", () => {
    expect(typeRefToZod({ kind: "str" }).parse("a")).toBe("a");
    expect(typeRefToZod({ kind: "list", of: { kind: "num" } }).parse([1, 2])).toEqual([1, 2]);
    expect(typeRefToZod({ kind: "nullable", of: { kind: "str" } }).parse(null)).toBeNull();
    expect(typeRefToZod({ kind: "enum", values: ["a", "b"] }).parse("b")).toBe("b");
  });
  it("makes optional object fields nullable (not optional)", () => {
    const schema = typeRefToZod({
      kind: "object",
      fields: [{ name: "x", type: { kind: "str" }, required: false }],
    });
    expect(schema.parse({ x: null })).toEqual({ x: null });
  });
});

describe("AiPlanner", () => {
  it("returns the LPL program from structured output", async () => {
    const planner = new AiPlanner(mockJson({ program: "return 1" }));
    const { source } = await planner.plan("do it", []);
    expect(source).toBe("return 1");
  });
  it("repairs using the same structured output path", async () => {
    const planner = new AiPlanner(mockJson({ program: "r = svc.ping()\nreturn r" }));
    const { source } = await planner.repair("do it", [], "bad", "some error");
    expect(source).toContain("svc.ping()");
  });
});

describe("AiQuarantine", () => {
  it("extracts and unwraps the typed value", async () => {
    const q = new AiQuarantine(mockJson({ value: "5-bullet summary" }));
    const out = await q.query({ source: ["a", "b"], instruction: "summarize", outputType: { kind: "str" } });
    expect(out).toBe("5-bullet summary");
  });
  it("returns a typed list value", async () => {
    const q = new AiQuarantine(mockJson({ value: ["x@a.com", "y@b.com"] }));
    const out = await q.query({
      source: "emails...",
      instruction: "extract addresses",
      outputType: { kind: "list", of: { kind: "str" } },
    });
    expect(out).toEqual(["x@a.com", "y@b.com"]);
  });
  it("throws a clean, trusted error when the model returns garbage", async () => {
    const q = new AiQuarantine(mockGarbage(), { maxRetries: 0 });
    await expect(
      q.query({ source: "x", instruction: "extract", outputType: { kind: "str" } }),
    ).rejects.toThrow(/quarantine could not extract/);
  });

  it("stringifies a non-string (object) source before extracting", async () => {
    const q = new AiQuarantine(mockJson({ value: "ok" }));
    const out = await q.query({
      source: [{ from: "a@x.com", body: "hi" }],
      instruction: "summarize",
      outputType: { kind: "str" },
    });
    expect(out).toBe("ok");
  });

  it("re-throws non-extraction errors unchanged (no masking)", async () => {
    const q = new AiQuarantine(mockThrows(), { maxRetries: 0 });
    await expect(
      q.query({ source: "x", instruction: "extract", outputType: { kind: "str" } }),
    ).rejects.toThrow(/network exploded/);
  });
});

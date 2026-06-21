import { describe, expect, it } from "vitest";
import { inputSchemaToParams, jsonSchemaToTypeRef } from "../src/index.js";

describe("jsonSchemaToTypeRef — allow-list with opaque degrade", () => {
  it("maps primitives", () => {
    expect(jsonSchemaToTypeRef({ type: "string" })).toEqual({ kind: "str" });
    expect(jsonSchemaToTypeRef({ type: "integer" })).toEqual({ kind: "num" });
    expect(jsonSchemaToTypeRef({ type: "number" })).toEqual({ kind: "num" });
    expect(jsonSchemaToTypeRef({ type: "boolean" })).toEqual({ kind: "bool" });
  });

  it("maps string enums, degrades non-string enums", () => {
    expect(jsonSchemaToTypeRef({ enum: ["a", "b"] })).toEqual({ kind: "enum", values: ["a", "b"] });
    expect(jsonSchemaToTypeRef({ enum: [1, 2] })).toEqual({ kind: "opaque" });
  });

  it("maps arrays and nested arrays", () => {
    expect(jsonSchemaToTypeRef({ type: "array", items: { type: "string" } })).toEqual({
      kind: "list",
      of: { kind: "str" },
    });
    expect(jsonSchemaToTypeRef({ type: "array" })).toEqual({ kind: "list", of: { kind: "opaque" } });
  });

  it("maps objects with named properties", () => {
    const t = jsonSchemaToTypeRef({
      type: "object",
      properties: { to: { type: "string" }, n: { type: "number" } },
      required: ["to"],
    });
    expect(t).toEqual({
      kind: "object",
      fields: [
        { name: "to", type: { kind: "str" }, required: true },
        { name: "n", type: { kind: "num" }, required: false },
      ],
    });
  });

  it("handles nullable forms", () => {
    expect(jsonSchemaToTypeRef({ type: ["string", "null"] })).toEqual({
      kind: "nullable",
      of: { kind: "str" },
    });
    expect(jsonSchemaToTypeRef({ anyOf: [{ type: "string" }, { type: "null" }] })).toEqual({
      kind: "nullable",
      of: { kind: "str" },
    });
  });

  it("degrades everything unsupported to opaque", () => {
    expect(jsonSchemaToTypeRef({ $ref: "#/defs/X" })).toEqual({ kind: "opaque" });
    expect(jsonSchemaToTypeRef({ oneOf: [{ type: "string" }, { type: "number" }] })).toEqual({
      kind: "opaque",
    });
    expect(jsonSchemaToTypeRef({ type: "object" })).toEqual({ kind: "opaque" });
    expect(jsonSchemaToTypeRef({})).toEqual({ kind: "opaque" });
    expect(jsonSchemaToTypeRef(undefined)).toEqual({ kind: "opaque" });
  });
});

describe("inputSchemaToParams", () => {
  it("maps a tool input schema into typed params", () => {
    const params = inputSchemaToParams({
      type: "object",
      properties: {
        to: { type: "string", description: "recipient" },
        body: { type: "string" },
      },
      required: ["to", "body"],
    });
    expect(params).toEqual([
      { name: "to", type: { kind: "str" }, required: true, description: "recipient" },
      { name: "body", type: { kind: "str" }, required: true },
    ]);
  });

  it("returns [] for a schema without properties", () => {
    expect(inputSchemaToParams({ type: "object" })).toEqual([]);
    expect(inputSchemaToParams(undefined)).toEqual([]);
  });
});

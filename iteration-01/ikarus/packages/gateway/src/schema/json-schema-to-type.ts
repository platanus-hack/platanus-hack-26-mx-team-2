import type { TypeRef, TypedParam } from "@ikarus/shared";

/**
 * Loose JSON Schema shape — upstream MCP tools publish arbitrary schemas, so we
 * only read the fields we map and ignore the rest.
 */
export interface JsonSchema {
  type?: string | string[];
  enum?: unknown[];
  items?: JsonSchema | JsonSchema[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  anyOf?: JsonSchema[];
  oneOf?: JsonSchema[];
  allOf?: JsonSchema[];
  nullable?: boolean;
  description?: string;
  $ref?: string;
  [k: string]: unknown;
}

const OPAQUE: TypeRef = { kind: "opaque" };

const primitive = (t: string): TypeRef | undefined => {
  switch (t) {
    case "string":
      return { kind: "str" };
    case "number":
    case "integer":
      return { kind: "num" };
    case "boolean":
      return { kind: "bool" };
    case "null":
      return { kind: "null" };
    default:
      return undefined;
  }
};

/**
 * Map a JSON Schema to the interpreter's TypeRef, following a strict allow-list
 * (§7.4). Anything unsupported — `$ref`, recursive shapes, non-trivial
 * `oneOf/anyOf`, dynamic `additionalProperties`, unknown — degrades to OPAQUE.
 * Degrading is safe by design: losing type precision never weakens the
 * capability guarantee.
 */
export function jsonSchemaToTypeRef(schema: JsonSchema | undefined): TypeRef {
  if (!schema || typeof schema !== "object") return OPAQUE;

  // $ref / recursive / unresolved → opaque (we never resolve refs).
  if (schema.$ref) return OPAQUE;

  // enum of strings → enum; otherwise opaque.
  if (Array.isArray(schema.enum)) {
    const values = schema.enum;
    if (values.length > 0 && values.every((v) => typeof v === "string")) {
      return { kind: "enum", values: values as string[] };
    }
    return OPAQUE;
  }

  // anyOf:[T, {type:null}] → nullable(T); any other union → opaque.
  const union = schema.anyOf ?? schema.oneOf;
  if (union) return mapNullableUnion(union);
  if (schema.allOf) return OPAQUE;

  // type as array, e.g. ["string","null"] → nullable; longer unions → opaque.
  if (Array.isArray(schema.type)) {
    const nonNull = schema.type.filter((t) => t !== "null");
    const hasNull = schema.type.includes("null");
    if (nonNull.length === 1) {
      const inner = primitive(nonNull[0]!) ?? OPAQUE;
      return hasNull ? { kind: "nullable", of: inner } : inner;
    }
    return OPAQUE;
  }

  const prim = schema.type ? primitive(schema.type) : undefined;
  if (prim) return schema.nullable ? { kind: "nullable", of: prim } : prim;

  if (schema.type === "array") {
    const items = Array.isArray(schema.items) ? undefined : schema.items;
    const of = jsonSchemaToTypeRef(items);
    return schema.nullable ? { kind: "nullable", of: { kind: "list", of } } : { kind: "list", of };
  }

  if (schema.type === "object") {
    if (!schema.properties) return OPAQUE; // free-form object → opaque
    const required = new Set(schema.required ?? []);
    const fields = Object.entries(schema.properties).map(([name, propSchema]) => ({
      name,
      type: jsonSchemaToTypeRef(propSchema),
      required: required.has(name),
    }));
    const obj: TypeRef = { kind: "object", fields };
    return schema.nullable ? { kind: "nullable", of: obj } : obj;
  }

  return OPAQUE;
}

function mapNullableUnion(union: JsonSchema[]): TypeRef {
  const nonNull = union.filter((s) => !(s.type === "null"));
  const hasNull = union.length !== nonNull.length;
  if (nonNull.length === 1) {
    const inner = jsonSchemaToTypeRef(nonNull[0]);
    return hasNull ? { kind: "nullable", of: inner } : inner;
  }
  return OPAQUE;
}

/** Map a tool's input schema (`{type:object, properties, required}`) to params. */
export function inputSchemaToParams(inputSchema: JsonSchema | undefined): TypedParam[] {
  if (!inputSchema?.properties) return [];
  const required = new Set(inputSchema.required ?? []);
  return Object.entries(inputSchema.properties).map(([name, propSchema]) => {
    const desc = typeof propSchema.description === "string" ? propSchema.description : undefined;
    return {
      name,
      type: jsonSchemaToTypeRef(propSchema),
      required: required.has(name),
      ...(desc ? { description: desc } : {}),
    };
  });
}

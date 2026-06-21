/**
 * The interpreter's own type system. Upstream MCP JSON Schemas are mapped into
 * this small, closed set; anything unsupported degrades to `opaque` (§7.4).
 *
 * This is intentionally tiny: a value's *type* never weakens the security
 * guarantee — capabilities do that. Types only help the Planner write correct
 * programs and let the Quarantine return structured values.
 */
export type TypeRef =
  | { readonly kind: "str" }
  | { readonly kind: "num" }
  | { readonly kind: "bool" }
  | { readonly kind: "null" }
  | { readonly kind: "enum"; readonly values: readonly string[] }
  | { readonly kind: "list"; readonly of: TypeRef }
  | {
      readonly kind: "object";
      readonly name?: string;
      readonly fields: ReadonlyArray<{ readonly name: string; readonly type: TypeRef; readonly required: boolean }>;
    }
  | { readonly kind: "nullable"; readonly of: TypeRef }
  /** Unsupported / degraded schema: always treated conservatively. */
  | { readonly kind: "opaque" };

export const T = {
  str: { kind: "str" } as const,
  num: { kind: "num" } as const,
  bool: { kind: "bool" } as const,
  null: { kind: "null" } as const,
  opaque: { kind: "opaque" } as const,
  list: (of: TypeRef): TypeRef => ({ kind: "list", of }),
  nullable: (of: TypeRef): TypeRef => ({ kind: "nullable", of }),
} as const;

/** Render a TypeRef as a compact, Planner-readable signature string. */
export function formatType(t: TypeRef): string {
  switch (t.kind) {
    case "str":
      return "str";
    case "num":
      return "num";
    case "bool":
      return "bool";
    case "null":
      return "null";
    case "opaque":
      return "opaque";
    case "enum":
      return `enum(${t.values.join("|")})`;
    case "list":
      return `list[${formatType(t.of)}]`;
    case "nullable":
      return `${formatType(t.of)}?`;
    case "object":
      return t.name ?? `object{${t.fields.map((f) => f.name).join(",")}}`;
  }
}

import { z } from "zod";
import type { TypeRef } from "@ikarus/shared";

/**
 * Convert the interpreter's TypeRef into a zod schema for the Quarantine's
 * `generateObject` call. Optional/nullable fields use `.nullable()` (NOT
 * `.optional()`) because some providers' strict structured-output mode (notably
 * OpenAI) rejects optional fields. `opaque` → unknown (the value stays untrusted
 * regardless, so precision here is irrelevant to security).
 */
export function typeRefToZod(t: TypeRef): z.ZodTypeAny {
  switch (t.kind) {
    case "str":
      return z.string();
    case "num":
      return z.number();
    case "bool":
      return z.boolean();
    case "null":
      return z.null();
    case "enum":
      return t.values.length > 0
        ? z.enum([...t.values] as [string, ...string[]])
        : z.string();
    case "list":
      return z.array(typeRefToZod(t.of));
    case "nullable":
      return typeRefToZod(t.of).nullable();
    case "object":
      return z.object(
        Object.fromEntries(
          t.fields.map((f) => [
            f.name,
            f.required ? typeRefToZod(f.type) : typeRefToZod(f.type).nullable(),
          ]),
        ),
      );
    case "opaque":
      return z.unknown();
  }
}

import type { Capability } from "@ikarus/shared";

/** A runtime value paired with its security capability. */
export interface TaggedValue {
  readonly value: unknown;
  readonly cap: Capability;
}

export const tag = (value: unknown, cap: Capability): TaggedValue => ({ value, cap });

/** Truncated, JSON-safe preview of a value for traces (never raw secrets). */
export function preview(value: unknown, max = 160): string {
  let s: string;
  try {
    s = typeof value === "string" ? value : JSON.stringify(value);
  } catch {
    s = String(value);
  }
  if (s === undefined) s = String(value);
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

/**
 * Capabilities: the per-value security metadata that is the heart of Ikarus.
 *
 * Every value the interpreter handles carries a Capability describing:
 *  - `provenance`: which sources contributed to it (union grows as values combine)
 *  - `trusted`:    whether it derives ONLY from the user's trusted task (control plane)
 *
 * Rule of the system: a value is `trusted` iff every input that produced it was
 * trusted. Tool outputs and Quarantine outputs are NEVER trusted. See the
 * `joinCaps` implementation in @ikarus/interpreter — the single chokepoint
 * through which all capability combination flows.
 */

/** A provenance source. Conventionally: "user", "mcp:<id>", "quarantine". */
export type Source = string;

export const SOURCE_USER: Source = "user";
export const SOURCE_QUARANTINE: Source = "quarantine";
export const mcpSource = (mcpId: string): Source => `mcp:${mcpId}`;

export interface Capability {
  readonly provenance: ReadonlySet<Source>;
  readonly trusted: boolean;
}

/** A JSON-serializable view of a capability, for traces and the UI. */
export interface CapabilitySnapshot {
  readonly provenance: readonly Source[];
  readonly trusted: boolean;
}

export function snapshotCapability(cap: Capability): CapabilitySnapshot {
  return { provenance: [...cap.provenance].sort(), trusted: cap.trusted };
}

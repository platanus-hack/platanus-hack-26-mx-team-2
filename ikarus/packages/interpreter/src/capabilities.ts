import { type Capability, type Source, SOURCE_USER, SOURCE_QUARANTINE, mcpSource } from "@ikarus/shared";

/**
 * THE capability chokepoint. Every value combination in the evaluator MUST flow
 * through `joinCaps`. The invariant it enforces is the whole security guarantee:
 *
 *   trusted   = AND of all inputs   (a value is trusted only if ALL inputs are)
 *   provenance = UNION of all inputs (sources never get dropped)
 *
 * A single forgotten union is a silent exfiltration hole — so there is exactly
 * one implementation, and it is tested adversarially.
 */
export function joinCaps(caps: readonly Capability[]): Capability {
  if (caps.length === 0) {
    // No inputs ⇒ a constant fully derived from the trusted plan.
    return { provenance: new Set([SOURCE_USER]), trusted: true };
  }
  const provenance = new Set<Source>();
  let trusted = true;
  for (const c of caps) {
    for (const s of c.provenance) provenance.add(s);
    trusted = trusted && c.trusted;
  }
  return { provenance, trusted };
}

/** A literal authored by the Planner: trusted, originating from the user task. */
export function userTrusted(): Capability {
  return { provenance: new Set([SOURCE_USER]), trusted: true };
}

/** A raw upstream tool result: untrusted, provenance = that MCP. */
export function toolResultCap(mcpId: string): Capability {
  return { provenance: new Set([mcpSource(mcpId)]), trusted: false };
}

/**
 * A Quarantine result: ALWAYS untrusted, regardless of inputs. Provenance is the
 * source's provenance plus the quarantine itself.
 */
export function quarantineCap(source: Capability): Capability {
  const provenance = new Set<Source>(source.provenance);
  provenance.add(SOURCE_QUARANTINE);
  return { provenance, trusted: false };
}

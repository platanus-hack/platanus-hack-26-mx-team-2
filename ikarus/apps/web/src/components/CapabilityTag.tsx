import { ShieldCheck, Warning } from "@phosphor-icons/react";
import type { CapSnapshot } from "../lib/api";

/** A capability rendered as trusted (green) or untrusted (red), with provenance. */
export function CapabilityTag({ cap }: { cap: CapSnapshot }) {
  const trusted = cap.trusted;
  const provenance = cap.provenance.length ? cap.provenance.join(", ") : "user";
  return (
    <span
      title={`provenance: ${provenance}`}
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10.5px] font-medium tnum ${
        trusted ? "border-trusted-dim bg-trusted-dim/30 text-trusted" : "border-blocked-dim bg-blocked-dim/30 text-blocked"
      }`}
    >
      {trusted ? <ShieldCheck size={12} weight="fill" /> : <Warning size={12} weight="fill" />}
      {trusted ? "trusted" : "untrusted"}
      <span className="opacity-60">· {provenance}</span>
    </span>
  );
}

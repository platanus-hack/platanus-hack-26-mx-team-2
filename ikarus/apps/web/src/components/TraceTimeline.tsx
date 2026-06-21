import {
  Brain,
  DownloadSimple,
  FlagBannerFold,
  Prohibit,
  WarningOctagon,
  type Icon,
} from "@phosphor-icons/react";
import type { TraceEvent } from "../lib/api";
import { CapabilityTag } from "./CapabilityTag";

const KIND: Record<TraceEvent["kind"], { icon: Icon; label: string; tone: string }> = {
  plan: { icon: FlagBannerFold, label: "Plan", tone: "var(--color-ink-faint)" },
  tool_call: { icon: DownloadSimple, label: "Tool call", tone: "var(--color-ink-dim)" },
  query_ai: { icon: Brain, label: "Quarantined read", tone: "var(--color-quarantine)" },
  policy_deny: { icon: Prohibit, label: "Policy denied", tone: "var(--color-blocked)" },
  return: { icon: FlagBannerFold, label: "Return", tone: "var(--color-trusted)" },
  error: { icon: WarningOctagon, label: "Error", tone: "var(--color-blocked)" },
};

function ArgList({ args }: { args: NonNullable<TraceEvent["args"]> }) {
  const entries = Object.entries(args);
  if (entries.length === 0) return null;
  return (
    <div className="mt-2.5 flex flex-col gap-1.5">
      {entries.map(([name, arg]) => (
        <div key={name} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px]">
          <code className="font-mono text-ink-dim">{name}</code>
          <span className="text-ink-faint">=</span>
          <code className="max-w-[28ch] truncate font-mono text-ink" title={arg.preview}>
            {arg.preview}
          </code>
          <CapabilityTag cap={arg.cap} />
        </div>
      ))}
    </div>
  );
}

function Event({ event, last }: { event: TraceEvent; last: boolean }) {
  const k = KIND[event.kind];
  const denied = event.kind === "policy_deny" || event.kind === "error";
  return (
    <li className="relative flex gap-3.5 pb-5">
      {!last && <span className="absolute left-[14px] top-8 bottom-0 w-px bg-line" aria-hidden />}
      <span
        className="relative z-[1] grid h-7 w-7 shrink-0 place-items-center rounded-full border"
        style={{ borderColor: k.tone, background: "var(--color-surface)", color: k.tone }}
      >
        <k.icon size={15} weight="bold" />
      </span>

      <div
        className={`min-w-0 flex-1 rounded-[10px] border px-3.5 py-2.5 ${
          denied ? "border-blocked-dim bg-blocked-dim/20" : "border-line bg-surface-2"
        }`}
      >
        <div className="flex items-center gap-2">
          <span className="text-[12px] font-semibold" style={{ color: denied ? "var(--color-blocked)" : "var(--color-ink)" }}>
            {k.label}
          </span>
          {event.mcpId && event.toolName ? (
            <code className="font-mono text-[12px] text-ink-dim">
              {event.mcpId}.{event.toolName}
            </code>
          ) : null}
          {event.ruleId ? <code className="ml-auto font-mono text-[10.5px] text-ink-faint">{event.ruleId}</code> : null}
        </div>

        {event.args ? <ArgList args={event.args} /> : null}
        {event.detail ? (
          <p className={`mt-2 text-[12px] leading-relaxed ${denied ? "text-blocked" : "text-ink-dim"}`}>{event.detail}</p>
        ) : null}
      </div>
    </li>
  );
}

export function TraceTimeline({ trace }: { trace: TraceEvent[] }) {
  return (
    <ol>
      {trace.map((e, i) => (
        <Event key={e.seq} event={e} last={i === trace.length - 1} />
      ))}
    </ol>
  );
}

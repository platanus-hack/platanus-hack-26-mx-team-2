import { Link, useParams } from "react-router-dom";
import { ArrowLeft, CheckCircle, ShieldSlash, WarningOctagon } from "@phosphor-icons/react";
import { api, type RunDetail } from "../lib/api";
import { useAsync } from "../lib/useAsync";
import { Spinner, ErrorNote, Badge } from "../components/ui";
import { TraceTimeline } from "../components/TraceTimeline";

function StatusBanner({ run }: { run: RunDetail }) {
  if (run.status === "blocked") {
    return (
      <div className="flex items-start gap-3 rounded-[var(--radius)] border border-blocked-dim bg-blocked-dim/25 px-4 py-3.5">
        <ShieldSlash size={20} weight="fill" className="mt-0.5 shrink-0 text-blocked" />
        <div>
          <p className="text-[14px] font-semibold text-blocked">Exfiltration blocked</p>
          <p className="mt-0.5 text-[13px] leading-relaxed text-ink-dim">
            {run.error ?? "A sink received an argument derived from untrusted data. The action was never executed."}
          </p>
        </div>
      </div>
    );
  }
  if (run.status === "error") {
    return (
      <div className="flex items-start gap-3 rounded-[var(--radius)] border border-line bg-surface-2 px-4 py-3.5">
        <WarningOctagon size={20} weight="fill" className="mt-0.5 shrink-0 text-ink-dim" />
        <div>
          <p className="text-[14px] font-semibold text-ink">Run errored</p>
          <p className="mt-0.5 text-[13px] leading-relaxed text-ink-dim">{run.error}</p>
        </div>
      </div>
    );
  }
  return (
    <div className="flex items-start gap-3 rounded-[var(--radius)] border border-trusted-dim bg-trusted-dim/20 px-4 py-3.5">
      <CheckCircle size={20} weight="fill" className="mt-0.5 shrink-0 text-trusted" />
      <div>
        <p className="text-[14px] font-semibold text-trusted">Completed safely</p>
        <p className="mt-0.5 text-[13px] leading-relaxed text-ink-dim">
          The task ran to completion. Any untrusted data stayed inert — read, parsed, never obeyed.
        </p>
      </div>
    </div>
  );
}

function Program({ source }: { source: string }) {
  const lines = source.replace(/\n+$/, "").split("\n");
  return (
    <pre className="overflow-x-auto rounded-[10px] border border-line bg-bg p-4 text-[12.5px] leading-[1.7]">
      <code className="font-mono">
        {lines.map((line, i) => (
          <div key={i} className="grid grid-cols-[2ch_1fr] gap-3">
            <span className="select-none text-right text-ink-faint tnum">{i + 1}</span>
            <span className="text-ink">{line || " "}</span>
          </div>
        ))}
      </code>
    </pre>
  );
}

export function RunDetailPage() {
  const { id = "" } = useParams();
  const { data: run, loading, error } = useAsync(() => api.runs.get(id), [id]);

  return (
    <>
      <Link
        to="/runs"
        className="pressable mb-5 inline-flex items-center gap-1.5 text-[13px] text-ink-dim hover:text-ink"
      >
        <ArrowLeft size={15} /> All traces
      </Link>

      {error ? <ErrorNote message={error} /> : null}
      {loading ? (
        <Spinner />
      ) : !run ? null : (
        <>
          <div className="mb-6">
            <div className="mb-3 flex items-center gap-2">
              <Badge tone={run.status === "completed" ? "trusted" : run.status === "blocked" ? "blocked" : "neutral"}>
                {run.status}
              </Badge>
            </div>
            <h1 className="text-[20px] font-semibold leading-snug tracking-tight text-ink">{run.task}</h1>
          </div>

          <div className="mb-6">
            <StatusBanner run={run} />
          </div>

          {/* Split screen: control flow (fixed, trusted) vs data flow (tracked). */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <section>
              <div className="mb-3">
                <h2 className="text-[13px] font-semibold text-ink">Control flow</h2>
                <p className="text-[12px] text-ink-dim">Fixed by the planner before any data was read.</p>
              </div>
              {run.program ? (
                <Program source={run.program} />
              ) : (
                <p className="rounded-[10px] border border-dashed border-line px-4 py-6 text-center text-[13px] text-ink-faint">
                  No program (planning failed before execution).
                </p>
              )}

              {run.status === "completed" && run.result != null ? (
                <div className="mt-4">
                  <h3 className="mb-2 text-[12px] font-medium text-ink-dim">Result</h3>
                  <pre className="overflow-x-auto rounded-[10px] border border-trusted-dim bg-trusted-dim/10 p-3.5 text-[12.5px] leading-relaxed text-ink">
                    <code className="font-mono">
                      {typeof run.result === "string" ? run.result : JSON.stringify(run.result, null, 2)}
                    </code>
                  </pre>
                </div>
              ) : null}
            </section>

            <section>
              <div className="mb-3">
                <h2 className="text-[13px] font-semibold text-ink">Data flow</h2>
                <p className="text-[12px] text-ink-dim">Capabilities tracked through every value.</p>
              </div>
              {run.trace.length ? (
                <TraceTimeline trace={run.trace} />
              ) : (
                <p className="rounded-[10px] border border-dashed border-line px-4 py-6 text-center text-[13px] text-ink-faint">
                  No trace events recorded.
                </p>
              )}
            </section>
          </div>
        </>
      )}
    </>
  );
}

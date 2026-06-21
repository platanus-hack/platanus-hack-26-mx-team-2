import { Link } from "react-router-dom";
import { CaretRight, Pulse } from "@phosphor-icons/react";
import { api, type RunSummary } from "../lib/api";
import { useAsync } from "../lib/useAsync";
import { PageHeader } from "../components/Shell";
import { Badge, EmptyState, ErrorNote, Skeleton } from "../components/ui";

const STATUS: Record<RunSummary["status"], { tone: "trusted" | "blocked" | "neutral"; label: string }> = {
  completed: { tone: "trusted", label: "Completed" },
  blocked: { tone: "blocked", label: "Blocked by policy" },
  error: { tone: "neutral", label: "Error" },
};

function when(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function Runs() {
  const { data, loading, error } = useAsync(() => api.runs.list(), []);

  return (
    <>
      <PageHeader
        title="Traces"
        subtitle="Every task executed through run_task, with its full data-flow trace. Blocked runs are where an injection tried to drive a sink with untrusted data."
      />

      {error ? <ErrorNote message={error} /> : null}

      {loading ? (
        <div className="flex flex-col gap-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-[58px] w-full" />
          ))}
        </div>
      ) : !data || data.length === 0 ? (
        <EmptyState
          icon={<Pulse size={26} />}
          title="No runs yet"
          body="Add Ikarus to Claude as a custom connector (see Connect) and call run_task. Runs and their traces will appear here."
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {data.map((run, i) => {
            const s = STATUS[run.status];
            return (
              <li key={run.id} className="enter" style={{ "--i": i } as React.CSSProperties}>
                <Link
                  to={`/runs/${run.id}`}
                  className="pressable group flex items-center gap-4 rounded-[var(--radius)] border border-line bg-surface px-4 py-3"
                >
                  <span
                    className="h-9 w-1 shrink-0 rounded-full"
                    style={{
                      background:
                        run.status === "blocked"
                          ? "var(--color-blocked)"
                          : run.status === "completed"
                            ? "var(--color-trusted)"
                            : "var(--color-line-strong)",
                    }}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[14px] font-medium text-ink">{run.task}</p>
                    <p className="mt-0.5 text-[11.5px] text-ink-faint tnum">{when(run.createdAt)}</p>
                  </div>
                  <Badge tone={s.tone}>{s.label}</Badge>
                  <CaretRight size={15} className="text-ink-faint transition-colors group-hover:text-ink-dim" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

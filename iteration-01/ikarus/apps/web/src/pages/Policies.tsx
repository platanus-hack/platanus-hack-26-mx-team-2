import { useEffect, useState } from "react";
import { ShieldChevron, Check, X, Trash } from "@phosphor-icons/react";
import { api, type PolicyRow } from "../lib/api";
import { useAsync } from "../lib/useAsync";
import { PageHeader } from "../components/Shell";
import { Badge, Button, Card, EmptyState, ErrorNote, Skeleton, Toggle } from "../components/ui";

function ArgChips({
  args,
  onChange,
}: {
  args: string[];
  onChange: (next: string[]) => void;
}) {
  const [draft, setDraft] = useState("");
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {args.map((a) => (
        <span key={a} className="inline-flex items-center gap-1 rounded-full border border-line bg-surface-2 py-0.5 pl-2 pr-1 text-[11.5px] text-ink">
          <code className="font-mono">{a}</code>
          <button
            onClick={() => onChange(args.filter((x) => x !== a))}
            className="pressable grid h-4 w-4 place-items-center rounded-full text-ink-faint hover:text-blocked"
            aria-label={`Remove ${a}`}
          >
            <X size={11} weight="bold" />
          </button>
        </span>
      ))}
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if ((e.key === "Enter" || e.key === ",") && draft.trim()) {
            e.preventDefault();
            if (!args.includes(draft.trim())) onChange([...args, draft.trim()]);
            setDraft("");
          }
        }}
        placeholder="add arg…"
        className="h-6 w-[88px] rounded-full border border-dashed border-line bg-transparent px-2 text-[11.5px] text-ink placeholder:text-ink-faint outline-none focus:border-accent"
      />
    </div>
  );
}

function PolicyCard({ row, onDeleted }: { row: PolicyRow; onDeleted: () => void }) {
  const [draft, setDraft] = useState(row);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [deleting, setDeleting] = useState(false);
  useEffect(() => setDraft(row), [row]);

  async function remove() {
    setDeleting(true);
    await api.policies.remove(row.id);
    onDeleted();
  }

  const dirty =
    draft.requireTrusted !== row.requireTrusted ||
    draft.sensitiveArgs.join() !== row.sensitiveArgs.join();

  async function save() {
    setSaving(true);
    await api.policies.update(row.id, {
      sensitiveArgs: draft.sensitiveArgs,
      requireTrusted: draft.requireTrusted,
    });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 1600);
  }

  return (
    <Card className="p-4">
      <div className="flex items-center gap-2">
        <code className="font-mono text-[14px] font-medium text-ink">
          {draft.mcpId}.{draft.toolName}
        </code>
        <Badge tone={draft.effect === "SINK" ? "blocked" : "trusted"}>{draft.effect.toLowerCase()}</Badge>
        <div className="ml-auto flex items-center gap-2">
          {saved ? (
            <span className="inline-flex items-center gap-1 text-[12px] text-trusted">
              <Check size={13} weight="bold" /> Saved
            </span>
          ) : dirty ? (
            <Button variant="primary" className="h-8" loading={saving} onClick={save}>
              Save
            </Button>
          ) : null}
          <Button variant="danger" className="h-8 px-2" loading={deleting} onClick={remove} aria-label="Delete policy">
            <Trash size={14} />
          </Button>
        </div>
      </div>

      {draft.effect === "SINK" ? (
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-[1fr_auto]">
          <div className="flex flex-col gap-1.5">
            <span className="text-[12px] font-medium text-ink-dim">Sensitive arguments</span>
            <ArgChips args={draft.sensitiveArgs} onChange={(next) => setDraft({ ...draft, sensitiveArgs: next })} />
            <span className="text-[11px] text-ink-faint">Any of these carrying untrusted data blocks the call.</span>
          </div>
          <label className="flex items-center gap-3 sm:flex-col sm:items-end sm:gap-1.5">
            <span className="text-[12px] font-medium text-ink-dim">Require trusted</span>
            <Toggle checked={draft.requireTrusted} onChange={(v) => setDraft({ ...draft, requireTrusted: v })} />
          </label>
        </div>
      ) : (
        <p className="mt-2 text-[12px] text-ink-faint">Reads have no external effect — always allowed.</p>
      )}
    </Card>
  );
}

export function Policies() {
  const { data, loading, error, reload } = useAsync(() => api.policies.list(), []);

  return (
    <>
      <PageHeader
        title="Policies"
        subtitle="Declarative rules per tool. Default-secure: a sink fed any untrusted argument is denied. Narrow which arguments are sensitive, or lift the trust requirement deliberately."
      />

      {error ? <ErrorNote message={error} /> : null}

      {loading ? (
        <div className="flex flex-col gap-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-[96px] w-full" />
          ))}
        </div>
      ) : !data || data.length === 0 ? (
        <EmptyState
          icon={<ShieldChevron size={26} />}
          title="No policies yet"
          body="Policies are seeded automatically when you connect an upstream MCP. Add a connection to populate this list."
        />
      ) : (
        <div className="flex flex-col gap-2">
          {data.map((row, i) => (
            <div key={row.id} className="enter" style={{ "--i": i } as React.CSSProperties}>
              <PolicyCard row={row} onDeleted={reload} />
            </div>
          ))}
        </div>
      )}
    </>
  );
}

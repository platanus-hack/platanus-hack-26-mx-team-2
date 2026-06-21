import { useEffect, useState } from "react";
import { Brain, Check, FlagBannerFold, Key } from "@phosphor-icons/react";
import { api, type ModelRow } from "../lib/api";
import { useAsync } from "../lib/useAsync";
import { PageHeader } from "../components/Shell";
import { Button, Card, ErrorNote, Field, Input, Select, Skeleton } from "../components/ui";

type Role = "PLANNER" | "QUARANTINE";

const ROLE_META: Record<Role, { title: string; blurb: string; icon: typeof Brain }> = {
  PLANNER: {
    title: "Planner",
    blurb: "Trusted. Turns the task into a fixed program before any data is read.",
    icon: FlagBannerFold,
  },
  QUARANTINE: {
    title: "Quarantine",
    blurb: "Parses untrusted data into typed values. No tools, no caching — output is always untrusted.",
    icon: Brain,
  },
};

function ModelCard({ role, current, onSaved }: { role: Role; current?: ModelRow; onSaved: () => void }) {
  const meta = ROLE_META[role];
  const [provider, setProvider] = useState<"ANTHROPIC" | "OPENAI">(current?.provider ?? "ANTHROPIC");
  const [modelId, setModelId] = useState(current?.modelId ?? "");
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (current) {
      setProvider(current.provider);
      setModelId(current.modelId);
    }
  }, [current]);

  const keyConfigured = current?.apiKey.configured;

  // Mirror PolicyCard: only surface Save when there's something to persist.
  const dirty =
    provider !== (current?.provider ?? "ANTHROPIC") ||
    modelId !== (current?.modelId ?? "") ||
    apiKey !== "";
  const valid = Boolean(modelId) && (keyConfigured || Boolean(apiKey));

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api.models.save(role, { provider, modelId, ...(apiKey ? { apiKey } : {}) });
      setApiKey("");
      setSaved(true);
      setTimeout(() => setSaved(false), 1600);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-5">
      <div className="mb-4 flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[8px] border border-line bg-surface-2 text-accent">
          <meta.icon size={18} />
        </span>
        <div>
          <h2 className="text-[15px] font-semibold text-ink">{meta.title}</h2>
          <p className="mt-0.5 max-w-md text-[12.5px] leading-relaxed text-ink-dim">{meta.blurb}</p>
        </div>
      </div>

      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Provider">
            <Select value={provider} onChange={(e) => setProvider(e.target.value as "ANTHROPIC" | "OPENAI")}>
              <option value="ANTHROPIC">Anthropic</option>
              <option value="OPENAI">OpenAI</option>
            </Select>
          </Field>
          <Field label="Model id">
            <Input
              value={modelId}
              onChange={(e) => setModelId(e.target.value)}
              placeholder={provider === "ANTHROPIC" ? "claude-opus-4-8" : "gpt-4o"}
            />
          </Field>
        </div>
        <Field
          label="API key"
          hint={
            keyConfigured
              ? `Configured (····${current?.apiKey.last4}). Leave blank to keep it.`
              : "Encrypted at rest. Write-only — never shown again."
          }
        >
          <div className="relative">
            <Key size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint" />
            <Input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={keyConfigured ? "•••••••••• (set)" : "sk-…"}
              className="pl-9"
            />
          </div>
        </Field>
        {error ? <ErrorNote message={error} /> : null}
        {saved ? (
          <span className="inline-flex items-center gap-1 text-[12px] text-trusted">
            <Check size={13} weight="bold" /> Saved
          </span>
        ) : dirty ? (
          <div>
            <Button variant="primary" loading={busy} onClick={save} disabled={!valid}>
              Save {meta.title.toLowerCase()}
            </Button>
          </div>
        ) : (
          <span className="text-[12px] text-ink-faint">
            {keyConfigured ? "Configured." : "Not configured yet."}
          </span>
        )}
      </div>
    </Card>
  );
}

export function Models() {
  const { data, loading, error, reload } = useAsync(() => api.models.list(), []);
  const byRole = (r: Role) => data?.find((m) => m.role === r);

  return (
    <>
      <PageHeader
        title="Models"
        subtitle="Your own LLM credentials power the Planner and the Quarantine. Keys are encrypted with a master key held outside the database and decrypted only in memory at run time."
      />

      {error ? <ErrorNote message={error} /> : null}

      {loading ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {[0, 1].map((i) => (
            <Skeleton key={i} className="h-[260px] w-full" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <ModelCard role="PLANNER" current={byRole("PLANNER")} onSaved={reload} />
          <ModelCard role="QUARANTINE" current={byRole("QUARANTINE")} onSaved={reload} />
        </div>
      )}
    </>
  );
}

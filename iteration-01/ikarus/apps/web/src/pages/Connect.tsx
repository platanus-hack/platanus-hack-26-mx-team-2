import { useState } from "react";
import { Copy, Check, Key, ArrowClockwise, WarningCircle } from "@phosphor-icons/react";
import { api, MCP_URL } from "../lib/api";
import { useAsync } from "../lib/useAsync";
import { PageHeader } from "../components/Shell";
import { Button, Card, ErrorNote, Skeleton } from "../components/ui";

function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  }
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[12px] font-medium text-ink-dim">{label}</span>
      <div className="flex items-stretch gap-2">
        <code className="flex-1 truncate rounded-[8px] border border-line bg-surface-2 px-3 py-2 font-mono text-[12.5px] text-ink">
          {value}
        </code>
        <Button onClick={copy} aria-label={`Copy ${label}`}>
          {copied ? <Check size={14} weight="bold" className="text-trusted" /> : <Copy size={14} />}
        </Button>
      </div>
    </div>
  );
}

export function Connect() {
  const { data, loading, error, reload } = useAsync(() => api.mcpKey.get(), []);
  const [freshKey, setFreshKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);

  async function generate() {
    setBusy(true);
    setGenError(null);
    try {
      const r = await api.mcpKey.generate();
      setFreshKey(r.key);
      reload();
    } catch (err) {
      setGenError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const configured = data?.configured;

  return (
    <>
      <PageHeader
        title="Connect"
        subtitle="Add Ikarus to Claude (or any MCP client) as a custom connector. Every task you run through it is planned safely and traced here — immune to prompt injection by design."
      />

      {error ? <ErrorNote message={error} /> : null}

      <div className="flex flex-col gap-4">
        <Card className="p-5">
          <h2 className="text-[15px] font-semibold text-ink">Your MCP endpoint</h2>
          <p className="mt-0.5 mb-4 text-[12.5px] text-ink-dim">
            Use this URL as the connector endpoint, with your personal key as a Bearer token.
          </p>
          <CopyField label="Endpoint URL" value={MCP_URL} />

          <div className="mt-5 border-t border-line pt-5">
            <div className="flex items-center gap-2">
              <Key size={16} className="text-accent" />
              <h3 className="text-[14px] font-medium text-ink">Personal key</h3>
            </div>

            {loading ? (
              <Skeleton className="mt-3 h-[40px] w-full" />
            ) : freshKey ? (
              <div className="mt-3 flex flex-col gap-2">
                <CopyField label="Key (shown once — copy it now)" value={freshKey} />
                <p className="inline-flex items-center gap-1 text-[12px] text-quarantine">
                  <WarningCircle size={13} weight="fill" /> This key won't be shown again. Store it in your MCP client.
                </p>
              </div>
            ) : (
              <p className="mt-3 text-[12.5px] text-ink-dim">
                {configured
                  ? `A key is configured (····${data?.last4}). Regenerate to get a new one — the old one stops working.`
                  : "No key yet. Generate one to authenticate your MCP client."}
              </p>
            )}

            {genError ? (
              <div className="mt-3">
                <ErrorNote message={genError} />
              </div>
            ) : null}

            <div className="mt-4">
              <Button variant="primary" loading={busy} onClick={generate}>
                <ArrowClockwise size={14} weight="bold" />
                {configured ? "Regenerate key" : "Generate key"}
              </Button>
            </div>
          </div>
        </Card>

        <Card className="p-5">
          <h2 className="text-[15px] font-semibold text-ink">Add it in Claude</h2>
          <ol className="mt-3 flex list-decimal flex-col gap-2 pl-5 text-[13px] leading-relaxed text-ink-dim">
            <li>Open Settings → Connectors → Add custom connector.</li>
            <li>
              Paste the <span className="font-medium text-ink">Endpoint URL</span> above.
            </li>
            <li>
              Set the <code className="font-mono text-ink">Authorization</code> header to{" "}
              <code className="font-mono text-ink">Bearer &lt;your key&gt;</code>.
            </li>
            <li>
              Call <code className="font-mono text-ink">run_task</code> with a complete task. Results and their full
              data-flow trace appear under <span className="font-medium text-ink">Traces</span>.
            </li>
          </ol>
          <p className="mt-3 text-[12px] text-ink-faint">
            The connector exposes your own connections, policies, and models — configure them in the other tabs first.
          </p>
        </Card>
      </div>
    </>
  );
}

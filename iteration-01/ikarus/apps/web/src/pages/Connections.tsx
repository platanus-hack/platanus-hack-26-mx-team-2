import { useState, type FormEvent } from "react";
import {
  Plus,
  PlugsConnected,
  Trash,
  Key,
  CheckCircle,
  WarningCircle,
  CaretRight,
  ShieldChevron,
} from "@phosphor-icons/react";
import { api, type Connection, type CatalogTool, type PolicyRow } from "../lib/api";
import { useAsync } from "../lib/useAsync";
import { PageHeader } from "../components/Shell";
import { Badge, Button, Card, EmptyState, ErrorNote, Field, Input, Select, Skeleton } from "../components/ui";

function AddForm({ onDone }: { onDone: () => void }) {
  const [label, setLabel] = useState("");
  const [transport, setTransport] = useState<"HTTP" | "STDIO">("HTTP");
  const [endpoint, setEndpoint] = useState("");
  const [credentials, setCredentials] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.connections.create({
        label,
        transport,
        endpoint,
        ...(credentials ? { credentials } : {}),
      });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <Card className="mb-6 p-5">
      <form onSubmit={submit} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Label" hint="The runtime id the gateway uses (e.g. mailbox).">
          <Input value={label} onChange={(e) => setLabel(e.target.value)} required placeholder="mailbox" />
        </Field>
        <Field label="Transport">
          <Select value={transport} onChange={(e) => setTransport(e.target.value as "HTTP" | "STDIO")}>
            <option value="HTTP">HTTP (Streamable)</option>
            <option value="STDIO">STDIO (command)</option>
          </Select>
        </Field>
        <Field label="Endpoint" hint={transport === "HTTP" ? "MCP server URL." : "command + args (JSON)."}>
          <Input value={endpoint} onChange={(e) => setEndpoint(e.target.value)} required placeholder="https://…/mcp" />
        </Field>
        <Field label="Credentials" hint="Encrypted at rest (AES-256-GCM). Write-only — never shown again.">
          <Input
            type="password"
            value={credentials}
            onChange={(e) => setCredentials(e.target.value)}
            placeholder="optional bearer / api key"
          />
        </Field>
        {error ? (
          <div className="sm:col-span-2">
            <ErrorNote message={error} />
          </div>
        ) : null}
        <div className="flex gap-2 sm:col-span-2">
          <Button type="submit" variant="primary" loading={busy}>
            Add connection
          </Button>
          <Button type="button" onClick={onDone}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  );
}

/** A single mapped tool with its params and a create-policy affordance. */
function ToolRow({
  conn,
  tool,
  policy,
  onPolicyChange,
}: {
  conn: Connection;
  tool: CatalogTool;
  policy?: PolicyRow;
  onPolicyChange: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isSink = tool.effect === "sink";

  async function createPolicy() {
    setBusy(true);
    setError(null);
    try {
      await api.policies.create({
        connectionId: conn.id,
        toolName: tool.name,
        effect: isSink ? "SINK" : "READ",
        // Pre-fill a sink's sensitive args with every parameter — the secure default.
        sensitiveArgs: isSink ? tool.params.map((p) => p.name) : [],
        requireTrusted: isSink,
      });
      onPolicyChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-[8px] border border-line bg-surface-2/40 p-3">
      <div className="flex items-center gap-2">
        <code className="font-mono text-[13px] font-medium text-ink">{tool.name}</code>
        <Badge tone={isSink ? "blocked" : "trusted"}>{tool.effect}</Badge>
        {policy ? (
          <span className="ml-auto inline-flex items-center gap-1 text-[12px] text-trusted">
            <ShieldChevron size={13} weight="fill" /> policy set
          </span>
        ) : (
          <Button variant="primary" className="ml-auto h-7 px-2.5 text-[12px]" loading={busy} onClick={createPolicy}>
            <Plus size={13} weight="bold" /> Create policy
          </Button>
        )}
      </div>
      {tool.description ? <p className="mt-1.5 text-[12px] text-ink-dim">{tool.description}</p> : null}
      {tool.params.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {tool.params.map((p) => (
            <span
              key={p.name}
              className="inline-flex items-center gap-1 rounded-full border border-line bg-surface px-2 py-0.5 text-[11px]"
              title={p.description}
            >
              <code className="font-mono text-ink">{p.name}</code>
              <span className="text-ink-faint">{p.type}</span>
              {p.required ? <span className="text-blocked">*</span> : null}
            </span>
          ))}
        </div>
      ) : (
        <p className="mt-2 text-[11.5px] text-ink-faint">No parameters.</p>
      )}
      {error ? <p className="mt-2 text-[12px] text-blocked">{error}</p> : null}
    </div>
  );
}

function Row({
  conn,
  policies,
  onDelete,
  onChange,
}: {
  conn: Connection;
  policies: PolicyRow[];
  onDelete: (id: string) => void;
  onChange: () => void;
}) {
  const isMock = conn.endpoint.startsWith("in-memory://");
  const [open, setOpen] = useState(false);
  const [credOpen, setCredOpen] = useState(false);
  const [credValue, setCredValue] = useState("");
  const [savingCred, setSavingCred] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [verifyMsg, setVerifyMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function saveCred() {
    setSavingCred(true);
    try {
      await api.connections.update(conn.id, { credentials: credValue });
      setCredValue("");
      setCredOpen(false);
      onChange();
    } finally {
      setSavingCred(false);
    }
  }
  const [catalog, setCatalog] = useState<CatalogTool[] | null>(null);
  const [catalogErr, setCatalogErr] = useState<string | null>(null);
  const [loadingCatalog, setLoadingCatalog] = useState(false);

  async function loadCatalog() {
    setLoadingCatalog(true);
    setCatalogErr(null);
    try {
      setCatalog(await api.connections.catalog(conn.id));
    } catch (err) {
      setCatalogErr(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingCatalog(false);
    }
  }

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next && catalog === null && !isMock) void loadCatalog();
  }

  async function verify() {
    setVerifying(true);
    setVerifyMsg(null);
    try {
      const r = await api.connections.verify(conn.id);
      if (r.mock) setVerifyMsg({ ok: false, text: "In-memory mock — not introspectable." });
      else if (r.status === "connected")
        setVerifyMsg({ ok: true, text: `Connected · ${r.toolCount ?? 0} tools mapped.` });
      else setVerifyMsg({ ok: false, text: r.error ?? "Verification failed." });
      // Refresh the freshly-cached catalog + status badge.
      if (open && !isMock) void loadCatalog();
      onChange();
    } catch (err) {
      setVerifyMsg({ ok: false, text: err instanceof Error ? err.message : String(err) });
    } finally {
      setVerifying(false);
    }
  }

  const policyFor = (toolName: string) =>
    policies.find((p) => p.mcpId === conn.label && p.toolName === toolName);

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center gap-4 p-4">
        <button
          onClick={toggle}
          className="pressable grid h-10 w-10 shrink-0 place-items-center rounded-[8px] border border-line bg-surface-2 text-accent"
          aria-label={open ? "Collapse" : "Expand"}
        >
          <CaretRight size={16} className="transition-transform" style={{ transform: open ? "rotate(90deg)" : "none" }} />
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <code className="font-mono text-[14px] font-medium text-ink">{conn.label}</code>
            <Badge tone={conn.status === "connected" ? "trusted" : conn.status === "error" ? "blocked" : "neutral"}>
              {conn.status}
            </Badge>
            {isMock ? <Badge tone="neutral">mock</Badge> : null}
          </div>
          <p className="mt-0.5 truncate text-[12px] text-ink-faint" title={conn.endpoint}>
            {conn.transport} · {conn.endpoint}
          </p>
        </div>
        {conn.credentials.configured ? (
          <span className="hidden items-center gap-1 text-[12px] text-ink-dim sm:inline-flex">
            <Key size={13} /> ····{conn.credentials.last4}
          </span>
        ) : null}
        {!isMock ? (
          <Button
            onClick={() => setCredOpen((v) => !v)}
            aria-label="Set credentials"
            title={conn.credentials.configured ? "Replace credentials" : "Set credentials"}
          >
            <Key size={15} />
          </Button>
        ) : null}
        <Button onClick={verify} loading={verifying} disabled={isMock} title={isMock ? "Mock connection" : "Verify & map"}>
          Verify
        </Button>
        <Button variant="danger" onClick={() => onDelete(conn.id)} aria-label={`Delete ${conn.label}`}>
          <Trash size={15} />
        </Button>
      </div>

      {credOpen ? (
        <div className="flex flex-wrap items-end gap-2 border-t border-line bg-surface-2/30 px-4 py-3">
          <div className="min-w-[220px] flex-1">
            <Field
              label="Credentials"
              hint={`Sent as Authorization: Bearer …. Encrypted at rest, write-only.${
                conn.credentials.configured ? " Leave blank to keep the current one." : ""
              }`}
            >
              <Input
                type="password"
                autoFocus
                value={credValue}
                onChange={(e) => setCredValue(e.target.value)}
                placeholder={conn.credentials.configured ? "•••••••••• (set)" : "bearer token / api key"}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && credValue) void saveCred();
                }}
              />
            </Field>
          </div>
          <Button variant="primary" loading={savingCred} disabled={!credValue} onClick={saveCred}>
            Save
          </Button>
          <Button onClick={() => { setCredOpen(false); setCredValue(""); }}>Cancel</Button>
        </div>
      ) : null}

      {verifyMsg ? (
        <div
          className={`flex items-center gap-1.5 border-t border-line px-4 py-2 text-[12px] ${
            verifyMsg.ok ? "text-trusted" : "text-blocked"
          }`}
        >
          {verifyMsg.ok ? <CheckCircle size={14} weight="fill" /> : <WarningCircle size={14} weight="fill" />}
          {verifyMsg.text}
        </div>
      ) : null}

      {open ? (
        <div className="border-t border-line bg-surface-2/30 p-4">
          {isMock ? (
            <p className="text-[12.5px] text-ink-dim">
              This is an in-memory demo mock. Connect a real MCP server (HTTP/STDIO) to map its tools and create
              policies from them.
            </p>
          ) : loadingCatalog ? (
            <div className="flex flex-col gap-2">
              <Skeleton className="h-[64px] w-full" />
              <Skeleton className="h-[64px] w-full" />
            </div>
          ) : catalogErr ? (
            <ErrorNote message={catalogErr} />
          ) : !catalog || catalog.length === 0 ? (
            <p className="text-[12.5px] text-ink-dim">
              No tools mapped yet. Click <span className="font-medium text-ink">Verify</span> to introspect this server.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {catalog.map((tool) => (
                <ToolRow
                  key={tool.name}
                  conn={conn}
                  tool={tool}
                  policy={policyFor(tool.name)}
                  onPolicyChange={onChange}
                />
              ))}
            </div>
          )}
        </div>
      ) : null}
    </Card>
  );
}

export function Connections() {
  const { data, loading, error, reload } = useAsync(() => api.connections.list(), []);
  const { data: policies, reload: reloadPolicies } = useAsync(() => api.policies.list(), []);
  const [adding, setAdding] = useState(false);

  async function remove(id: string) {
    await api.connections.remove(id);
    reload();
  }

  function refreshAll() {
    reload();
    reloadPolicies();
  }

  return (
    <>
      <PageHeader
        title="Connections"
        subtitle="Upstream MCP servers Ikarus aggregates. Credentials are encrypted at rest and decrypted only in memory at execution time — never returned to this UI. Verify a connection to map its tools and create policies from them."
        action={
          !adding ? (
            <Button variant="primary" onClick={() => setAdding(true)}>
              <Plus size={15} weight="bold" /> New connection
            </Button>
          ) : undefined
        }
      />

      {adding ? (
        <AddForm
          onDone={() => {
            setAdding(false);
            reload();
          }}
        />
      ) : null}

      {error ? <ErrorNote message={error} /> : null}

      {loading ? (
        <div className="flex flex-col gap-2">
          {[0, 1].map((i) => (
            <Skeleton key={i} className="h-[74px] w-full" />
          ))}
        </div>
      ) : !data || data.length === 0 ? (
        <EmptyState
          icon={<PlugsConnected size={26} />}
          title="No connections"
          body="Add an upstream MCP server to expose its tools through Ikarus. Verify it to map each tool, then create default-secure policies."
        />
      ) : (
        <div className="flex flex-col gap-2">
          {data.map((conn, i) => (
            <div key={conn.id} className="enter" style={{ "--i": i } as React.CSSProperties}>
              <Row conn={conn} policies={policies ?? []} onDelete={remove} onChange={refreshAll} />
            </div>
          ))}
        </div>
      )}
    </>
  );
}

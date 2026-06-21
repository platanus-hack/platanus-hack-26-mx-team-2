import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { Plus, PlugsConnected, Trash, Key, CaretRight } from "@phosphor-icons/react";
import { api, type Connection } from "../lib/api";
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
        <Field label="Credentials" hint="Optional. You can also authorize via OAuth on the connection page.">
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

function Row({ conn, onDelete }: { conn: Connection; onDelete: (id: string) => void }) {
  const isMock = conn.endpoint.startsWith("in-memory://");
  return (
    <div className="flex items-stretch gap-2">
      <Link
        to={`/connections/${conn.id}`}
        className="pressable group flex flex-1 items-center gap-4 rounded-[var(--radius)] border border-line bg-surface p-4"
      >
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[8px] border border-line bg-surface-2 text-accent">
          <PlugsConnected size={18} />
        </span>
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
        <CaretRight size={16} className="shrink-0 text-ink-faint transition-colors group-hover:text-ink-dim" />
      </Link>
      <Button variant="danger" onClick={() => onDelete(conn.id)} aria-label={`Delete ${conn.label}`} className="h-auto">
        <Trash size={15} />
      </Button>
    </div>
  );
}

export function Connections() {
  const { data, loading, error, reload } = useAsync(() => api.connections.list(), []);
  const [adding, setAdding] = useState(false);

  async function remove(id: string) {
    await api.connections.remove(id);
    reload();
  }

  return (
    <>
      <PageHeader
        title="Connections"
        subtitle="Upstream MCP servers Ikarus aggregates. Open one to authorize it, map its tools, and manage per-tool policies. Credentials are encrypted at rest and never returned to this UI."
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
          body="Add an upstream MCP server to expose its tools through Ikarus. Open it to authorize, map tools, and set policies."
        />
      ) : (
        <div className="flex flex-col gap-2">
          {data.map((conn, i) => (
            <div key={conn.id} className="enter" style={{ "--i": i } as React.CSSProperties}>
              <Row conn={conn} onDelete={remove} />
            </div>
          ))}
        </div>
      )}
    </>
  );
}

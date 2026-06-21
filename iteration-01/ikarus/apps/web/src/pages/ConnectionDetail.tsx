import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import {
  ArrowLeft,
  CaretRight,
  Check,
  CheckCircle,
  WarningCircle,
  Key,
  SignIn,
  ShieldChevron,
  Trash,
  X,
  Plus,
} from "@phosphor-icons/react";
import { api, type CatalogTool, type Connection, type PolicyRow } from "../lib/api";
import { useAsync } from "../lib/useAsync";
import { Badge, Button, Card, ErrorNote, Field, Input, Spinner, Toggle } from "../components/ui";

/** Editable list of sensitive-argument names, seeded from the tool's params. */
function ArgChips({ args, params, onChange }: { args: string[]; params: string[]; onChange: (next: string[]) => void }) {
  const [draft, setDraft] = useState("");
  const add = (a: string) => {
    const v = a.trim();
    if (v && !args.includes(v)) onChange([...args, v]);
  };
  const unused = params.filter((p) => !args.includes(p));
  return (
    <div className="flex flex-col gap-1.5">
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
              add(draft);
              setDraft("");
            }
          }}
          placeholder="add arg…"
          className="h-6 w-[88px] rounded-full border border-dashed border-line bg-transparent px-2 text-[11.5px] text-ink placeholder:text-ink-faint outline-none focus:border-accent"
        />
      </div>
      {unused.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1">
          <span className="text-[11px] text-ink-faint">from params:</span>
          {unused.map((p) => (
            <button
              key={p}
              onClick={() => add(p)}
              className="pressable rounded-full border border-dashed border-line px-2 py-0.5 text-[11px] text-ink-dim hover:text-ink"
            >
              + {p}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** One mapped tool as a dropdown that manages its policy inline. */
function ToolPolicy({
  conn,
  tool,
  policy,
  onChange,
}: {
  conn: Connection;
  tool: CatalogTool;
  policy?: PolicyRow;
  onChange: () => void;
}) {
  const isSink = tool.effect === "sink";
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [draft, setDraft] = useState<PolicyRow | undefined>(policy);
  useEffect(() => setDraft(policy), [policy]);

  const dirty =
    !!policy &&
    !!draft &&
    (draft.requireTrusted !== policy.requireTrusted || draft.sensitiveArgs.join() !== policy.sensitiveArgs.join());

  async function create() {
    setBusy(true);
    try {
      await api.policies.create({
        connectionId: conn.id,
        toolName: tool.name,
        effect: isSink ? "SINK" : "READ",
        sensitiveArgs: isSink ? tool.params.map((p) => p.name) : [],
        requireTrusted: isSink,
      });
      setOpen(true);
      onChange();
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!draft) return;
    setBusy(true);
    try {
      await api.policies.update(draft.id, {
        sensitiveArgs: draft.sensitiveArgs,
        requireTrusted: draft.requireTrusted,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
      onChange();
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!policy) return;
    setBusy(true);
    try {
      await api.policies.remove(policy.id);
      onChange();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="pressable flex w-full items-center gap-2 p-3.5 text-left"
      >
        <CaretRight size={15} className="shrink-0 text-ink-faint" style={{ transform: open ? "rotate(90deg)" : "none" }} />
        <code className="font-mono text-[13.5px] font-medium text-ink">{tool.name}</code>
        <Badge tone={isSink ? "blocked" : "trusted"}>{tool.effect}</Badge>
        <span className="ml-auto inline-flex items-center gap-1 text-[12px]">
          {policy ? (
            <span className="inline-flex items-center gap-1 text-trusted">
              <ShieldChevron size={13} weight="fill" /> policy
            </span>
          ) : (
            <span className="text-ink-faint">no policy</span>
          )}
        </span>
      </button>

      {open ? (
        <div className="border-t border-line bg-surface-2/30 p-4">
          {tool.description ? <p className="mb-3 text-[12px] text-ink-dim">{tool.description}</p> : null}
          {tool.params.length > 0 ? (
            <div className="mb-3 flex flex-wrap gap-1.5">
              {tool.params.map((p) => (
                <span key={p.name} className="inline-flex items-center gap-1 rounded-full border border-line bg-surface px-2 py-0.5 text-[11px]" title={p.description}>
                  <code className="font-mono text-ink">{p.name}</code>
                  <span className="text-ink-faint">{p.type}</span>
                  {p.required ? <span className="text-blocked">*</span> : null}
                </span>
              ))}
            </div>
          ) : null}

          {!policy || !draft ? (
            <Button variant="primary" className="h-8" loading={busy} onClick={create}>
              <Plus size={13} weight="bold" /> Create policy
            </Button>
          ) : isSink ? (
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <span className="text-[12px] font-medium text-ink-dim">Sensitive arguments</span>
                <ArgChips
                  args={draft.sensitiveArgs}
                  params={tool.params.map((p) => p.name)}
                  onChange={(next) => setDraft({ ...draft, sensitiveArgs: next })}
                />
                <span className="text-[11px] text-ink-faint">Any of these carrying untrusted data blocks the call.</span>
              </div>
              <label className="flex items-center gap-3">
                <Toggle checked={draft.requireTrusted} onChange={(v) => setDraft({ ...draft, requireTrusted: v })} />
                <span className="text-[12px] font-medium text-ink-dim">Require trusted</span>
              </label>
              <div className="flex items-center gap-2">
                {saved ? (
                  <span className="inline-flex items-center gap-1 text-[12px] text-trusted">
                    <Check size={13} weight="bold" /> Saved
                  </span>
                ) : dirty ? (
                  <Button variant="primary" className="h-8" loading={busy} onClick={save}>
                    Save
                  </Button>
                ) : null}
                <Button variant="danger" className="ml-auto h-8 px-2.5" loading={busy} onClick={remove}>
                  <Trash size={14} /> Delete policy
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <p className="text-[12px] text-ink-faint">Reads have no external effect — always allowed.</p>
              <Button variant="danger" className="ml-auto h-8 px-2.5" loading={busy} onClick={remove}>
                <Trash size={14} /> Delete policy
              </Button>
            </div>
          )}
        </div>
      ) : null}
    </Card>
  );
}

export function ConnectionDetail() {
  const { id = "" } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const [credOpen, setCredOpen] = useState(false);
  const [credValue, setCredValue] = useState("");
  const [savingCred, setSavingCred] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [authorizing, setAuthorizing] = useState(false);
  const [actionMsg, setActionMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const { data, loading, error, reload } = useAsync(async () => {
    const [conns, policies] = await Promise.all([api.connections.list(), api.policies.list()]);
    const conn = conns.find((c) => c.id === id) ?? null;
    let catalog: CatalogTool[] = [];
    let catalogErr: string | null = null;
    if (conn && !conn.endpoint.startsWith("in-memory://")) {
      try {
        catalog = await api.connections.catalog(id);
      } catch (e) {
        catalogErr = e instanceof Error ? e.message : String(e);
      }
    }
    return { conn, catalog, catalogErr, policies: policies.filter((p) => conn && p.mcpId === conn.label) };
  }, [id]);

  const oauth = searchParams.get("oauth");
  const oauthMsg = searchParams.get("msg");
  useEffect(() => {
    if (oauth) {
      const t = setTimeout(() => setSearchParams({}, { replace: true }), 6000);
      return () => clearTimeout(t);
    }
  }, [oauth, setSearchParams]);

  const conn = data?.conn ?? null;

  async function verify() {
    if (!conn) return;
    setVerifying(true);
    setActionMsg(null);
    try {
      const r = await api.connections.verify(conn.id);
      if (r.status === "connected") setActionMsg({ ok: true, text: `Connected · ${r.toolCount ?? 0} tools mapped.` });
      else setActionMsg({ ok: false, text: r.error ?? "Verification failed." });
      reload();
    } catch (err) {
      setActionMsg({ ok: false, text: err instanceof Error ? err.message : String(err) });
    } finally {
      setVerifying(false);
    }
  }

  async function authorize() {
    if (!conn) return;
    setAuthorizing(true);
    try {
      const { authorizationUrl } = await api.connections.oauthStart(conn.id);
      window.location.href = authorizationUrl;
    } catch (err) {
      setActionMsg({ ok: false, text: err instanceof Error ? err.message : String(err) });
      setAuthorizing(false);
    }
  }

  async function saveCred() {
    if (!conn) return;
    setSavingCred(true);
    try {
      await api.connections.update(conn.id, { credentials: credValue });
      setCredValue("");
      setCredOpen(false);
      reload();
    } finally {
      setSavingCred(false);
    }
  }

  if (loading) return <Spinner />;
  if (error) return <ErrorNote message={error} />;
  if (!conn) return <ErrorNote message="Connection not found." />;

  const isMock = conn.endpoint.startsWith("in-memory://");

  return (
    <>
      <Link to="/connections" className="pressable mb-4 inline-flex items-center gap-1.5 text-[13px] text-ink-dim hover:text-ink">
        <ArrowLeft size={14} /> Connections
      </Link>

      <Card className="mb-5 p-5">
        <div className="flex flex-wrap items-center gap-3">
          <code className="font-mono text-[18px] font-semibold text-ink">{conn.label}</code>
          <Badge tone={conn.status === "connected" ? "trusted" : conn.status === "error" ? "blocked" : "neutral"}>
            {conn.status}
          </Badge>
          {isMock ? <Badge tone="neutral">mock</Badge> : null}
          {conn.credentials.configured ? (
            <span className="inline-flex items-center gap-1 text-[12px] text-ink-dim">
              <Key size={13} /> ····{conn.credentials.last4}
            </span>
          ) : null}
          <div className="ml-auto flex items-center gap-2">
            {!isMock ? (
              <>
                <Button onClick={authorize} loading={authorizing} title="Authorize via OAuth (browser redirect)">
                  <SignIn size={15} /> Authorize
                </Button>
                <Button onClick={() => setCredOpen((v) => !v)} title="Set token manually">
                  <Key size={15} />
                </Button>
              </>
            ) : null}
            <Button variant="primary" onClick={verify} loading={verifying} disabled={isMock}>
              Verify &amp; map
            </Button>
          </div>
        </div>
        <p className="mt-2 truncate text-[12.5px] text-ink-faint" title={conn.endpoint}>
          {conn.transport} · {conn.endpoint}
        </p>

        {credOpen ? (
          <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-line pt-3">
            <div className="min-w-[220px] flex-1">
              <Field label="Credentials" hint={`Sent as Authorization: Bearer …. Encrypted, write-only.${conn.credentials.configured ? " Leave blank to keep current." : ""}`}>
                <Input
                  type="password"
                  autoFocus
                  value={credValue}
                  onChange={(e) => setCredValue(e.target.value)}
                  placeholder={conn.credentials.configured ? "•••••••••• (set)" : "bearer token / api key"}
                  onKeyDown={(e) => { if (e.key === "Enter" && credValue) void saveCred(); }}
                />
              </Field>
            </div>
            <Button variant="primary" loading={savingCred} disabled={!credValue} onClick={saveCred}>Save</Button>
            <Button onClick={() => { setCredOpen(false); setCredValue(""); }}>Cancel</Button>
          </div>
        ) : null}

        {oauth === "connected" ? (
          <div className="mt-3 flex items-center gap-1.5 rounded-[8px] border border-trusted-dim bg-trusted-dim/25 px-3 py-2 text-[13px] text-trusted">
            <CheckCircle size={15} weight="fill" /> Authorized — token stored. Click Verify to map its tools.
          </div>
        ) : oauth === "error" ? (
          <div className="mt-3"><ErrorNote message={`OAuth failed: ${oauthMsg ?? "unknown error"}`} /></div>
        ) : actionMsg ? (
          <div className={`mt-3 flex items-center gap-1.5 text-[12px] ${actionMsg.ok ? "text-trusted" : "text-blocked"}`}>
            {actionMsg.ok ? <CheckCircle size={14} weight="fill" /> : <WarningCircle size={14} weight="fill" />}
            {actionMsg.text}
          </div>
        ) : null}
      </Card>

      <h2 className="mb-3 text-[14px] font-semibold text-ink">
        Mapped tools{data?.catalog.length ? ` · ${data.catalog.length}` : ""}
      </h2>

      {isMock ? (
        <p className="text-[12.5px] text-ink-dim">In-memory demo mock — not introspectable.</p>
      ) : data?.catalogErr ? (
        <ErrorNote message={data.catalogErr} />
      ) : !data || data.catalog.length === 0 ? (
        <Card className="p-5 text-[12.5px] text-ink-dim">
          No tools mapped yet. Click <span className="font-medium text-ink">Verify &amp; map</span> to introspect this server.
        </Card>
      ) : (
        <div className="flex flex-col gap-2">
          {data.catalog.map((tool) => (
            <ToolPolicy
              key={tool.name}
              conn={conn}
              tool={tool}
              policy={data.policies.find((p) => p.toolName === tool.name)}
              onChange={reload}
            />
          ))}
        </div>
      )}
    </>
  );
}

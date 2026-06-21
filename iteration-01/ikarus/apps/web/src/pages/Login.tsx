import { useState, type FormEvent } from "react";
import { ArrowRight } from "@phosphor-icons/react";
import { supabase, supabaseConfigured } from "../lib/supabase";
import { Wordmark } from "../components/Shell";
import { Button, ErrorNote, Field, Input } from "../components/ui";

export function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!supabase) return;
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setError(error.message);
    setBusy(false);
  }

  return (
    <div className="grid min-h-[100dvh] grid-cols-1 lg:grid-cols-[1fr_minmax(420px,46%)]">
      {/* Left: the value prop. Single focused message, no decoration strip. */}
      <section className="relative hidden flex-col justify-between border-r border-line px-12 py-12 lg:flex">
        <Wordmark size={17} />
        <div className="max-w-md">
          <h1 className="text-[34px] font-semibold leading-[1.1] tracking-tight text-ink">
            Untrusted data can read your tools. It can never command them.
          </h1>
          <p className="mt-4 text-[14px] leading-relaxed text-ink-dim">
            Ikarus sits between your agent and your real tools. A planner fixes the control flow before any
            email, page, or ticket is read, so a prompt injection has nothing to hijack.
          </p>
          <ul className="mt-7 flex flex-col gap-3 text-[13px] text-ink-dim">
            {[
              "Capabilities track trust through every value",
              "Sinks fed untrusted arguments are blocked, not executed",
              "Every run leaves an auditable data-flow trace",
            ].map((t) => (
              <li key={t} className="flex items-center gap-2.5">
                <span className="h-1.5 w-1.5 rounded-full bg-accent" />
                {t}
              </li>
            ))}
          </ul>
        </div>
        <p className="text-[12px] text-ink-faint">IA Safety · prompt-injection defense by design</p>
      </section>

      {/* Right: auth. */}
      <section className="flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-[340px]">
          <div className="mb-7 lg:hidden">
            <Wordmark size={17} />
          </div>
          <h2 className="text-[19px] font-semibold tracking-tight text-ink">Sign in</h2>
          <p className="mt-1 text-[13px] text-ink-dim">Use your Ikarus workspace account.</p>

          {!supabaseConfigured ? (
            <div className="mt-6">
              <ErrorNote message="Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to enable login." />
            </div>
          ) : (
            <form onSubmit={submit} className="mt-6 flex flex-col gap-4">
              <Field label="Email">
                <Input
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@company.com"
                />
              </Field>
              <Field label="Password">
                <Input
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••••••"
                />
              </Field>
              {error ? <ErrorNote message={error} /> : null}
              <Button type="submit" variant="primary" loading={busy} className="mt-1 w-full">
                {busy ? "Signing in" : "Sign in"}
                {!busy && <ArrowRight size={15} weight="bold" />}
              </Button>
            </form>
          )}
        </div>
      </section>
    </div>
  );
}

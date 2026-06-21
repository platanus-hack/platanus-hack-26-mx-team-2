import { NavLink, Outlet } from "react-router-dom";
import { PlugsConnected, Robot, ShieldChevron, Pulse, SignOut, LinkSimple } from "@phosphor-icons/react";
import type { Icon } from "@phosphor-icons/react";
import { useAuth } from "../lib/auth";

const NAV: { to: string; label: string; icon: Icon }[] = [
  { to: "/runs", label: "Traces", icon: Pulse },
  { to: "/connections", label: "Connections", icon: PlugsConnected },
  { to: "/models", label: "Models", icon: Robot },
  { to: "/connect", label: "Connect", icon: LinkSimple },
];

export function Wordmark({ size = 15 }: { size?: number }) {
  return (
    <span className="inline-flex items-center gap-2 font-semibold tracking-tight text-ink" style={{ fontSize: size }}>
      <span
        className="grid h-6 w-6 place-items-center rounded-[7px] border border-accent-strong"
        style={{ background: "linear-gradient(150deg, rgba(255,122,26,0.28), rgba(255,122,26,0.05))" }}
      >
        <ShieldChevron size={14} weight="fill" className="text-accent" />
      </span>
      Ikarus
    </span>
  );
}

export function Shell() {
  const { email, signOut } = useAuth();
  return (
    <div className="mx-auto grid min-h-[100dvh] max-w-[1400px] grid-cols-[232px_1fr]">
      <aside className="sticky top-0 flex h-[100dvh] flex-col border-r border-line px-4 py-5">
        <div className="px-2 pb-6">
          <Wordmark />
          <p className="mt-1 pl-8 text-[11px] leading-tight text-ink-faint">Prompt-injection defense</p>
        </div>

        <nav className="flex flex-col gap-1">
          {NAV.map(({ to, label, icon: Ic }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `pressable flex items-center gap-2.5 rounded-[8px] px-2.5 py-2 text-[13px] font-medium ${
                  isActive ? "bg-surface-2 text-ink" : "text-ink-dim hover:text-ink"
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <Ic size={17} weight={isActive ? "fill" : "regular"} className={isActive ? "text-accent" : ""} />
                  {label}
                </>
              )}
            </NavLink>
          ))}
        </nav>

        <div className="mt-auto border-t border-line pt-4">
          <p className="truncate px-2.5 text-[12px] text-ink-dim" title={email ?? ""}>
            {email ?? "Signed in"}
          </p>
          <button
            onClick={signOut}
            className="pressable mt-2 flex w-full items-center gap-2 rounded-[8px] px-2.5 py-2 text-[13px] text-ink-dim hover:text-ink"
          >
            <SignOut size={16} />
            Sign out
          </button>
        </div>
      </aside>

      <main className="min-w-0 px-8 py-8">
        <Outlet />
      </main>
    </div>
  );
}

export function PageHeader({ title, subtitle, action }: { title: string; subtitle: string; action?: React.ReactNode }) {
  return (
    <header className="mb-7 flex items-start justify-between gap-4">
      <div>
        <h1 className="text-[22px] font-semibold tracking-tight text-ink">{title}</h1>
        <p className="mt-1 max-w-xl text-[13px] leading-relaxed text-ink-dim">{subtitle}</p>
      </div>
      {action}
    </header>
  );
}

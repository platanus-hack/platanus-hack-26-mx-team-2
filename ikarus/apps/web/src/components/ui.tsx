import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";
import { CircleNotch } from "@phosphor-icons/react";

type Variant = "primary" | "ghost" | "danger";

export function Button({
  variant = "ghost",
  loading,
  children,
  className = "",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; loading?: boolean }) {
  const base =
    "pressable inline-flex items-center justify-center gap-2 rounded-[8px] px-3.5 h-9 text-[13px] font-medium border select-none disabled:opacity-50 disabled:pointer-events-none whitespace-nowrap";
  const skin: Record<Variant, string> = {
    primary: "bg-accent text-[#1f0d02] font-semibold border-accent-strong hover:bg-accent-strong",
    ghost: "bg-surface-2 text-ink border-line hover:text-ink",
    danger: "bg-transparent text-blocked border-blocked-dim hover:bg-blocked-dim/40",
  };
  return (
    <button className={`${base} ${skin[variant]} ${className}`} {...rest}>
      {loading ? <CircleNotch size={15} weight="bold" className="animate-spin" /> : children}
    </button>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-[var(--radius)] border border-line bg-surface ${className}`}>{children}</div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[12px] font-medium text-ink-dim">{label}</span>
      {children}
      {hint ? <span className="text-[11px] text-ink-faint">{hint}</span> : null}
    </label>
  );
}

const inputCls =
  "h-9 w-full rounded-[8px] border border-line bg-surface-2 px-3 text-[13px] text-ink placeholder:text-ink-faint outline-none focus:border-accent transition-colors";

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${inputCls} ${props.className ?? ""}`} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`${inputCls} ${props.className ?? ""}`} />;
}

export function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="pressable relative h-[22px] w-[38px] rounded-full border"
      style={{
        background: checked ? "var(--color-accent)" : "var(--color-surface-2)",
        borderColor: checked ? "var(--color-accent-strong)" : "var(--color-line-strong)",
      }}
    >
      <span
        className="absolute top-[2px] h-[16px] w-[16px] rounded-full bg-white shadow-sm"
        style={{ left: checked ? 18 : 2, transition: "left 160ms var(--ease-out)" }}
      />
    </button>
  );
}

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "trusted" | "blocked" | "quarantine" }) {
  const tones = {
    neutral: "border-line text-ink-dim bg-surface-2",
    trusted: "border-trusted-dim text-trusted bg-trusted-dim/30",
    blocked: "border-blocked-dim text-blocked bg-blocked-dim/30",
    quarantine: "border-quarantine/30 text-quarantine bg-quarantine/10",
  };
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${tones[tone]}`}>
      {children}
    </span>
  );
}

export function Spinner() {
  return (
    <div className="flex items-center justify-center py-16 text-ink-faint">
      <CircleNotch size={22} className="animate-spin" />
    </div>
  );
}

export function EmptyState({ icon, title, body }: { icon: ReactNode; title: string; body: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-[var(--radius)] border border-dashed border-line py-16 px-6 text-center">
      <div className="text-ink-faint">{icon}</div>
      <p className="text-[14px] font-medium text-ink">{title}</p>
      <p className="max-w-sm text-[13px] leading-relaxed text-ink-dim">{body}</p>
    </div>
  );
}

export function ErrorNote({ message }: { message: string }) {
  return (
    <div className="rounded-[8px] border border-blocked-dim bg-blocked-dim/25 px-3 py-2 text-[13px] text-blocked">
      {message}
    </div>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-[6px] bg-surface-2 ${className}`} />;
}

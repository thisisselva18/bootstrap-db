"use client";

import { useEffect, useRef, type ButtonHTMLAttributes, type ReactNode } from "react";

export function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-ink-2">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Card({
  title,
  subtitle,
  actions,
  children,
  className,
  pad = true,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  pad?: boolean;
}) {
  return (
    <section className={cx("rounded-xl border border-line bg-surface", className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-start justify-between gap-2 border-b border-line px-4 py-3">
          <div className="min-w-0">
            {title && <h2 className="text-sm font-semibold">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-xs text-ink-3">{subtitle}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={pad ? "p-4" : ""}>{children}</div>
    </section>
  );
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md";
  busy?: boolean;
};

export function Button({ variant = "secondary", size = "md", busy, className, children, disabled, ...rest }: ButtonProps) {
  return (
    <button
      {...rest}
      disabled={disabled || busy}
      className={cx(
        "inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        size === "sm" ? "px-2.5 py-1 text-xs" : "px-3.5 py-2 text-sm",
        variant === "primary" && "bg-accent text-accent-ink hover:opacity-90",
        variant === "secondary" && "border border-line bg-surface hover:bg-surface-2",
        variant === "ghost" && "hover:bg-surface-2",
        variant === "danger" && "border border-line bg-surface text-critical-ink hover:bg-surface-2",
        className,
      )}
    >
      {busy && <Spinner small />}
      {children}
    </button>
  );
}

export function Spinner({ small }: { small?: boolean }) {
  return (
    <span
      aria-hidden
      className={cx(
        "inline-block animate-spin rounded-full border-2 border-current border-t-transparent",
        small ? "h-3 w-3" : "h-5 w-5",
      )}
    />
  );
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 py-8 text-sm text-ink-3" role="status">
      <Spinner /> {label}
    </div>
  );
}

export function ErrorNote({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm">
      <span className="flex items-center gap-2 text-critical-ink">
        <span aria-hidden>⚠</span> {message}
      </span>
      {onRetry && (
        <Button size="sm" onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="py-6 text-center text-sm text-ink-3">{children}</p>;
}

export function Notice({ kind, children }: { kind: "success" | "error"; children: ReactNode }) {
  return (
    <div
      role={kind === "error" ? "alert" : "status"}
      className={cx(
        "flex items-start gap-2 rounded-lg border border-line px-3 py-2 text-sm",
        kind === "success" ? "bg-surface-2 text-good-ink" : "bg-surface-2 text-critical-ink",
      )}
    >
      <span aria-hidden>{kind === "success" ? "✓" : "⚠"}</span>
      <span>{children}</span>
    </div>
  );
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="rounded-xl border border-line bg-surface px-4 py-3">
      <div className="text-xs font-medium text-ink-3">{label}</div>
      <div className="tabular mt-1 text-2xl font-semibold tracking-tight">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-ink-3">{hint}</div>}
    </div>
  );
}

const STATUS_META: Record<string, { icon: string; color: string; label: string }> = {
  present: { icon: "●", color: "var(--good)", label: "Present" },
  late: { icon: "◐", color: "var(--warning)", label: "Late" },
  absent: { icon: "○", color: "var(--critical)", label: "Absent" },
  excused: { icon: "◌", color: "var(--text-3)", label: "Excused" },
};

/** Attendance status: icon + label, never colour alone. */
export function StatusBadge({ status }: { status: string | null }) {
  const meta = STATUS_META[status ?? ""] ?? { icon: "–", color: "var(--text-3)", label: "No record" };
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-line px-2 py-0.5 text-xs whitespace-nowrap">
      <span aria-hidden style={{ color: meta.color }}>
        {meta.icon}
      </span>
      {meta.label}
    </span>
  );
}

const RISK_META: Record<string, { icon: string; color: string; label: string }> = {
  LOW: { icon: "✓", color: "var(--good)", label: "Low risk" },
  MEDIUM: { icon: "!", color: "var(--warning)", label: "Medium risk" },
  HIGH: { icon: "✕", color: "var(--critical)", label: "High risk" },
};

export function RiskBadge({ risk }: { risk: string }) {
  const meta = RISK_META[risk] ?? RISK_META.LOW;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-line px-2 py-0.5 text-xs whitespace-nowrap">
      <span
        aria-hidden
        className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full text-[9px] font-bold text-white"
        style={{ background: meta.color }}
      >
        {meta.icon}
      </span>
      {meta.label}
    </span>
  );
}

export function Pill({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "accent" }) {
  return (
    <span
      className={cx(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs whitespace-nowrap",
        tone === "accent" ? "bg-accent-soft text-ink" : "bg-surface-2 text-ink-2",
      )}
    >
      {children}
    </span>
  );
}

const GROUP_COLORS: Record<string, string> = {
  Red: "var(--red)",
  Blue: "var(--blue)",
  Green: "var(--green)",
  Purple: "var(--purple)",
  Yellow: "var(--yellow)",
};

/** Colour group name with its swatch (the swatch is decoration; the name carries meaning). */
export function GroupTag({ name }: { name: string | null }) {
  if (!name) return <span className="text-ink-3">—</span>;
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <span aria-hidden className="h-2.5 w-2.5 rounded-full" style={{ background: GROUP_COLORS[name] ?? "var(--text-3)" }} />
      {name}
    </span>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium text-ink-2">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-ink-3">{hint}</span>}
    </label>
  );
}

/** Scrollable table wrapper; tables never overflow the page horizontally. */
export function TableWrap({ children }: { children: ReactNode }) {
  return (
    <div className="-mx-4 overflow-x-auto px-4">
      <table className="w-full min-w-[560px] border-collapse text-sm [&_td]:border-b [&_td]:border-line [&_td]:px-2 [&_td]:py-2 [&_th]:border-b [&_th]:border-line [&_th]:px-2 [&_th]:py-2 [&_th]:text-left [&_th]:text-xs [&_th]:font-medium [&_th]:text-ink-3">
        {children}
      </table>
    </div>
  );
}

export function Modal({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      className="m-auto w-[min(560px,calc(100vw-32px))] rounded-xl border border-line bg-surface p-0 text-ink backdrop:bg-black/40"
    >
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <h2 className="text-base font-semibold">{title}</h2>
        <button aria-label="Close" onClick={onClose} className="rounded px-2 text-ink-3 hover:bg-surface-2">
          ✕
        </button>
      </div>
      <div className="max-h-[75vh] overflow-y-auto p-4">{open && children}</div>
    </dialog>
  );
}

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: Array<{ id: T; label: string }>;
  value: T;
  onChange: (id: T) => void;
}) {
  return (
    <div role="tablist" className="mb-4 flex flex-wrap gap-1 border-b border-line">
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={value === t.id}
          onClick={() => onChange(t.id)}
          className={cx(
            "-mb-px border-b-2 px-3 py-2 text-sm",
            value === t.id ? "border-accent font-medium text-ink" : "border-transparent text-ink-2 hover:text-ink",
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function pct(v: number | null | undefined) {
  return v == null ? "—" : `${Number(v).toFixed(1)}%`;
}

export function time(v: string | null | undefined) {
  if (!v) return "—";
  const t = v.includes(" ") ? v.split(" ")[1] : v;
  return t.slice(0, 5);
}

export const DAY_NAMES = ["", "Day 1 · Mon", "Day 2 · Tue", "Day 3 · Wed", "Day 4 · Thu", "Day 5 · Fri"];

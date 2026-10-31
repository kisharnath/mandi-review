import clsx from "clsx";
import Link from "next/link";
import type { ReactNode } from "react";

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">{title}</h1>
        {description && <p className="mt-1 max-w-3xl text-sm text-zinc-600">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

const TONES = {
  gray: "bg-zinc-100 text-zinc-700 ring-zinc-200",
  green: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  red: "bg-red-50 text-red-700 ring-red-200",
  amber: "bg-amber-50 text-amber-800 ring-amber-200",
  blue: "bg-sky-50 text-sky-800 ring-sky-200",
  violet: "bg-violet-50 text-violet-800 ring-violet-200",
} as const;
export type Tone = keyof typeof TONES;

export function Badge({ tone = "gray", children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return (
    <span title={title} className={clsx("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset", TONES[tone])}>
      {children}
    </span>
  );
}

export function StatCard({ label, value, hint, href, tone }: { label: string; value: ReactNode; hint?: ReactNode; href?: string; tone?: "warn" | "bad" }) {
  const body = (
    <div className={clsx("card h-full p-4", href && "transition-colors hover:border-emerald-300")}>
      <div className="text-xs font-medium tracking-wide text-zinc-500 uppercase">{label}</div>
      <div className={clsx("mt-1 text-2xl font-semibold tabular-nums", tone === "bad" ? "text-red-700" : tone === "warn" ? "text-amber-700" : "text-zinc-900")}>{value}</div>
      {hint && <div className="mt-1 text-xs text-zinc-500">{hint}</div>}
    </div>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="card flex flex-col items-center justify-center px-6 py-12 text-center">
      <div className="text-sm font-medium text-zinc-800">{title}</div>
      {children && <div className="mt-1 max-w-md text-sm text-zinc-500">{children}</div>}
    </div>
  );
}

export function Flash({ msg, err }: { msg?: string; err?: string }) {
  if (!msg && !err) return null;
  return (
    <div
      role="status"
      className={clsx(
        "mb-4 rounded-lg border px-4 py-2.5 text-sm",
        err ? "border-red-200 bg-red-50 text-red-800" : "border-emerald-200 bg-emerald-50 text-emerald-900",
      )}
    >
      {err || msg}
    </div>
  );
}

export function SectionTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mb-2 flex items-center justify-between gap-2">
      <h2 className="text-sm font-semibold text-zinc-800">{children}</h2>
      {aside}
    </div>
  );
}

export const TYPE_LABELS: Record<string, { label: string; tone: Tone }> = {
  run_failed: { label: "Scrape failed", tone: "red" },
  unmapped_commodity: { label: "Crop not matched", tone: "amber" },
  suspicious_mapping: { label: "Crop match looks wrong", tone: "violet" },
  duplicate_alias: { label: "Name in many groups", tone: "violet" },
  unknown_market: { label: "Mandi not found", tone: "blue" },
  price_invalid: { label: "Price looks wrong", tone: "red" },
};

export function TypeBadge({ type }: { type: string }) {
  const t = TYPE_LABELS[type] ?? { label: type, tone: "gray" as Tone };
  return <Badge tone={t.tone}>{t.label}</Badge>;
}

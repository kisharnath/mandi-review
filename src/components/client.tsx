"use client";

import clsx from "clsx";
import { Check, ChevronsUpDown, Loader2, Search, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { useFormStatus } from "react-dom";

/** Set or clear URL search params and reset to page 1. */
function useSetParams() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, start] = useTransition();
  const set = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(changes)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    if (!("page" in changes)) next.delete("page");
    next.delete("msg");
    next.delete("err");
    start(() => router.replace(`${pathname}?${next.toString()}`, { scroll: false }));
  };
  return { set, pending, params };
}

export function SearchBox({ placeholder = "Search…", param = "q", autoFocus }: { placeholder?: string; param?: string; autoFocus?: boolean }) {
  const { set, pending, params } = useSetParams();
  const [value, setValue] = useState(params.get(param) ?? "");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => setValue(params.get(param) ?? ""), [params, param]);

  const onChange = (v: string) => {
    setValue(v);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => set({ [param]: v.trim() || null }), 350);
  };

  return (
    <div className="relative w-full max-w-md">
      <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-zinc-400" />
      <input
        className="input pr-8 pl-9"
        value={value}
        placeholder={placeholder}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
        aria-label={placeholder}
      />
      {pending ? (
        <Loader2 className="absolute top-1/2 right-3 h-4 w-4 -translate-y-1/2 animate-spin text-zinc-400" />
      ) : value ? (
        <button type="button" aria-label="Clear search" onClick={() => onChange("")} className="absolute top-1/2 right-2.5 -translate-y-1/2 text-zinc-400 hover:text-zinc-700">
          <X className="h-4 w-4" />
        </button>
      ) : null}
    </div>
  );
}

export function FilterSelect({ param, label, options, allLabel = "All" }: {
  param: string;
  label: string;
  options: { value: string; label: string }[];
  allLabel?: string;
}) {
  const { set, params } = useSetParams();
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="text-zinc-500">{label}</span>
      <select
        className="input w-auto max-w-56 py-1"
        value={params.get(param) ?? ""}
        onChange={(e) => set({ [param]: e.target.value || null })}
      >
        <option value="">{allLabel}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </label>
  );
}

export function DateFilter({ param, label }: { param: string; label: string }) {
  const { set, params } = useSetParams();
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="text-zinc-500">{label}</span>
      <input type="date" className="input w-auto py-1" value={params.get(param) ?? ""} onChange={(e) => set({ [param]: e.target.value || null })} />
    </label>
  );
}

export function Tabs({ param, tabs }: { param: string; tabs: { value: string; label: string; count?: number }[] }) {
  const { set, params } = useSetParams();
  const current = params.get(param) ?? tabs[0]?.value ?? "";
  return (
    <div className="inline-flex flex-wrap gap-1 rounded-lg bg-zinc-100 p-1">
      {tabs.map((t) => (
        <button
          key={t.value}
          type="button"
          onClick={() => set({ [param]: t.value === tabs[0]?.value ? null : t.value })}
          className={clsx(
            "rounded-md px-3 py-1 text-sm font-medium transition-colors",
            current === t.value ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-600 hover:text-zinc-900",
          )}
        >
          {t.label}
          {t.count !== undefined && <span className="ml-1.5 text-xs text-zinc-500 tabular-nums">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function SubmitButton({ children, className = "btn-primary", confirm, name, value }: {
  children: ReactNode;
  className?: string;
  confirm?: string;
  name?: string;
  value?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      name={name}
      value={value}
      disabled={pending}
      className={className}
      onClick={(e) => {
        if (confirm && !window.confirm(confirm)) return e.preventDefault();
        // React's form actions drop the clicked button's name/value, so copy it into a
        // hidden input. Clear the one left by an earlier button first.
        const form = e.currentTarget.form;
        if (!form) return;
        form.querySelectorAll("input[data-submitter]").forEach((el) => el.remove());
        if (!name) return;
        const input = document.createElement("input");
        Object.assign(input, { type: "hidden", name, value: value ?? "" });
        input.dataset.submitter = "";
        form.appendChild(input);
      }}
    >
      {pending && <Loader2 className="h-4 w-4 animate-spin" />}
      {children}
    </button>
  );
}

type PickItem = { id: string; label: string; sub?: string };

/** Searchable dropdown backed by /api/search. Puts the chosen id in a hidden input. */
export function Picker({ kind, name, state, placeholder, initial }: {
  kind: "products" | "crops" | "mandis";
  name: string;
  state?: string;
  placeholder: string;
  initial?: PickItem | null;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [items, setItems] = useState<PickItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [chosen, setChosen] = useState<PickItem | null>(initial ?? null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const ctrl = new AbortController();
    setLoading(true);
    const t = setTimeout(() => {
      const url = `/api/search?kind=${kind}&q=${encodeURIComponent(q)}${state ? `&state=${encodeURIComponent(state)}` : ""}`;
      fetch(url, { signal: ctrl.signal })
        .then((r) => r.json())
        .then((d) => setItems(d.items ?? []))
        .catch(() => {})
        .finally(() => setLoading(false));
    }, 200);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q, open, kind, state]);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  return (
    <div ref={box} className="relative w-full">
      <input type="hidden" name={name} value={chosen?.id ?? ""} />
      <button type="button" onClick={() => setOpen((o) => !o)} className="input flex items-center justify-between text-left">
        <span className={clsx("truncate", !chosen && "text-zinc-400")}>{chosen ? chosen.label : placeholder}</span>
        <ChevronsUpDown className="h-4 w-4 shrink-0 text-zinc-400" />
      </button>
      {open && (
        <div className="absolute z-30 mt-1 w-full overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-lg">
          <div className="border-b border-zinc-100 p-2">
            <input autoFocus className="input" placeholder="Type to search…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <ul className="max-h-72 overflow-y-auto py-1 text-sm">
            {loading && <li className="px-3 py-2 text-zinc-500">Searching…</li>}
            {!loading && items.length === 0 && <li className="px-3 py-2 text-zinc-500">Nothing found</li>}
            {!loading &&
              items.map((it) => (
                <li key={it.id}>
                  <button
                    type="button"
                    className="flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-emerald-50"
                    onClick={() => {
                      setChosen(it);
                      setOpen(false);
                    }}
                  >
                    <Check className={clsx("mt-0.5 h-4 w-4 shrink-0", chosen?.id === it.id ? "text-emerald-700" : "invisible")} />
                    <span>
                      <span className="block font-medium text-zinc-900">{it.label}</span>
                      {it.sub && <span className="block text-xs text-zinc-500">{it.sub}</span>}
                    </span>
                  </button>
                </li>
              ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/**
 * Checkbox that toggles every checkbox with the same name in a form, including boxes
 * outside the <form> element that join it with form="<id>" (rows of a table).
 */
export function SelectAll({ name, form }: { name: string; form?: string }) {
  return (
    <input
      type="checkbox"
      form={form}
      aria-label="Select all"
      className="h-4 w-4 accent-emerald-700"
      onChange={(e) => {
        const checked = e.currentTarget.checked;
        const owner = e.currentTarget.form;
        if (!owner) return;
        for (const el of Array.from(owner.elements)) {
          if (el instanceof HTMLInputElement && el.type === "checkbox" && el.name === name) el.checked = checked;
        }
      }}
    />
  );
}

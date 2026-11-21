"use client";

import clsx from "clsx";
import { MapPin } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { mergeTwoMandisAction, relinkMandiNameAction } from "@/app/actions";
import { SubmitButton } from "@/components/client";

export type GraphMandi = { id: string; name: string; district: string | null; postcode: string | null; hasLocation: boolean; source: string | null; listings: number; keep: boolean };
export type GraphName = { id: string; raw: string; source: string; status: string; listings: number; mandiId: string | null };

/** One colour per mandi copy, so every line says which copy a name points at. */
const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const COLORS = ["#047857", "#0369a1", "#7c3aed", "#c2410c", "#be123c", "#0f766e"];

const NH = 52; // name node height
const NG = 8; // gap between name nodes
const MH = 112; // mandi node height
const MG = 12;

/**
 * Link graph for one group of same-named mandis: mandi names on the left, the mandi copies on
 * the right, one line per link. Click a name, then the mandi it should point at, to re-link it.
 */
export function DupGraph({ mandis, names, editor, back }: { mandis: GraphMandi[]; names: GraphName[]; editor: boolean; back: string }) {
  const [selected, setSelected] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [move, setMove] = useState<{ name: GraphName; mandi: GraphMandi } | null>(null);

  const letterOf = new Map(mandis.map((m, i) => [m.id, LETTERS[i % 26]]));
  const colorOf = new Map(mandis.map((m, i) => [m.id, COLORS[i % COLORS.length]]));
  const nameY = (i: number) => i * (NH + NG) + NH / 2;
  const mandiY = (j: number) => j * (MH + MG) + MH / 2;
  const height = Math.max(names.length * (NH + NG) - NG, mandis.length * (MH + MG) - MG);
  const focus = selected ?? hover;
  const focusName = names.find((n) => n.id === focus);
  const focusMandi = mandis.find((m) => m.id === focus);
  const lit = (n: GraphName) => !focus || focus === n.id || focus === n.mandiId;
  const sel = names.find((n) => n.id === selected) ?? null;

  const clickMandi = (m: GraphMandi) => {
    if (sel && editor && sel.mandiId !== m.id) setMove({ name: sel, mandi: m });
    else setHover(null);
  };

  return (
    <div>
      {editor && (
        <div className="mb-3 min-h-9 text-xs">
          {move ? (
            <form action={relinkMandiNameAction} className="flex flex-wrap items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-amber-900">
              <input type="hidden" name="back" value={back} />
              <input type="hidden" name="id" value={move.name.id} />
              <input type="hidden" name="mandiId" value={move.mandi.id} />
              <span>
                Link <b>{move.name.raw}</b> ({move.name.source}, {move.name.listings} listings) to <b>{move.mandi.name}</b>
                {move.mandi.district ? `, ${move.mandi.district}` : ""}?
              </span>
              <SubmitButton className="btn-primary">Yes, link it</SubmitButton>
              <button type="button" className="btn-secondary" onClick={() => setMove(null)}>Cancel</button>
            </form>
          ) : sel ? (
            <div className="flex items-center gap-2 rounded-lg bg-sky-50 px-3 py-2 text-sky-900">
              <span><b>{sel.raw}</b> selected. Click the mandi on the right it should point to.</span>
              <button type="button" className="underline" onClick={() => setSelected(null)}>Clear</button>
            </div>
          ) : (
            <div className="rounded-lg bg-zinc-50 px-3 py-2 text-zinc-600">To change one link: click a mandi name on the left, then the mandi it belongs to. To merge two copies: use “Merge into” on a card (A, B… are the letters on each mandi).</div>
          )}
        </div>
      )}

      <div className="grid grid-cols-[minmax(0,1fr)_72px_minmax(0,1fr)] sm:grid-cols-[minmax(0,1fr)_120px_minmax(0,1fr)]">
        <div className="space-y-2" style={{ minHeight: height }}>
          {names.map((n) => (
            <button
              key={n.id}
              type="button"
              style={{ height: NH, borderLeftColor: n.mandiId ? colorOf.get(n.mandiId) : "#f59e0b" }}
              onMouseEnter={() => setHover(n.id)}
              onMouseLeave={() => setHover(null)}
              onClick={() => (editor ? setSelected(selected === n.id ? null : n.id) : undefined)}
              className={clsx(
                "block w-full rounded-lg border border-l-4 bg-white px-2.5 text-left transition",
                selected === n.id ? "border-sky-500 ring-2 ring-sky-200" : "border-zinc-200 hover:border-zinc-300",
                !lit(n) && "opacity-40",
                editor && "cursor-pointer",
              )}
            >
              <div className="truncate text-sm font-medium text-zinc-900">{n.raw}</div>
              <div className="flex items-center gap-1.5 truncate text-xs text-zinc-500">
                {n.source} · <span className="tabular-nums">{n.listings}</span> listings
                {!n.mandiId && <span className="rounded bg-amber-100 px-1 font-medium text-amber-800">not linked</span>}
              </div>
            </button>
          ))}
        </div>

        <svg className="h-full w-full" style={{ height }} viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" aria-hidden>
          {names.map((n, i) => {
            const j = mandis.findIndex((m) => m.id === n.mandiId);
            if (j < 0) return null;
            const y1 = nameY(i);
            const y2 = mandiY(j);
            const on = focus === n.id || focus === n.mandiId;
            return (
              <path
                key={n.id}
                d={`M0 ${y1} C 55 ${y1}, 45 ${y2}, 100 ${y2}`}
                fill="none"
                stroke={colorOf.get(n.mandiId!)}
                strokeWidth={on ? 4 : Math.min(3, 1.5 + Math.log10(n.listings + 1) * 0.5)}
                strokeLinecap="round"
                opacity={lit(n) ? (on ? 1 : 0.65) : 0.12}
                vectorEffect="non-scaling-stroke"
              />
            );
          })}
        </svg>

        <div className="space-y-3">
          {mandis.map((m) => {
            const color = colorOf.get(m.id)!;
            const targetable = !!sel && editor && sel.mandiId !== m.id;
            const dim = focusName ? focusName.mandiId !== m.id : false;
            return (
              <div
                key={m.id}
                style={{ height: MH, borderLeftColor: color }}
                onMouseEnter={() => setHover(m.id)}
                onMouseLeave={() => setHover(null)}
                onClick={() => clickMandi(m)}
                className={clsx(
                  "overflow-hidden rounded-lg border border-l-4 bg-white p-2.5 transition",
                  targetable ? "cursor-pointer border-sky-400 ring-2 ring-sky-200 hover:bg-sky-50" : "border-zinc-200",
                  m.keep && !targetable && "bg-emerald-50/40",
                  !targetable && dim && "opacity-40",
                  !targetable && focusMandi && focusMandi.id !== m.id && "opacity-60",
                )}
              >
                <div className="flex min-w-0 items-center gap-1.5">
                  <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-[10px] font-bold text-white" style={{ background: color }}>{letterOf.get(m.id)}</span>
                  <Link href={`/mandis/${m.id}`} onClick={(e) => (targetable ? e.preventDefault() : e.stopPropagation())} className="truncate text-sm font-semibold text-zinc-900 hover:underline">{m.name}</Link>
                  {m.keep && <span className="rounded bg-emerald-100 px-1 text-[11px] font-medium text-emerald-800">keep</span>}
                </div>
                <div className="mt-0.5 text-xs text-zinc-600">{m.district ?? <span className="text-zinc-400">no district</span>}{m.postcode ? ` · ${m.postcode}` : ""}</div>
                <div className="mt-0.5 flex items-center gap-2 text-xs text-zinc-500">
                  <span className={clsx("inline-flex items-center gap-0.5", !m.hasLocation && "text-zinc-300")}><MapPin className="h-3 w-3" />{m.hasLocation ? "location" : "no location"}</span>
                  <span>{m.source ?? "unknown"}</span>
                  <span className="tabular-nums">{m.listings} listings</span>
                </div>
                {editor && mandis.length > 1 && (
                  <div className="mt-2 flex items-center gap-1 overflow-x-auto text-xs text-zinc-500" onClick={(e) => e.stopPropagation()}>
                    <span className="shrink-0">Merge into</span>
                    {mandis.filter((o) => o.id !== m.id).map((o) => {
                      const count = names.filter((n) => n.mandiId === m.id).length;
                      return (
                        <form key={o.id} action={mergeTwoMandisAction} className="shrink-0">
                          <input type="hidden" name="back" value={back} />
                          <input type="hidden" name="fromId" value={m.id} />
                          <input type="hidden" name="intoId" value={o.id} />
                          <SubmitButton
                            className="flex h-6 min-w-6 items-center justify-center rounded px-1.5 text-[11px] font-bold text-white hover:opacity-80 disabled:opacity-30"
                            title={count ? `Move the ${count} name(s) of ${letterOf.get(m.id)} to ${o.name}${o.district ? `, ${o.district}` : ""}` : "No names are linked to this copy"}
                            style={{ background: colorOf.get(o.id) }}
                            disabled={count === 0}
                            confirm={`Move ${count} name(s) linked to ${m.name}${m.district ? `, ${m.district}` : ""} (${letterOf.get(m.id)}) onto ${o.name}${o.district ? `, ${o.district}` : ""} (${letterOf.get(o.id)})? Other copies are not changed.`}
                          >
                            → {letterOf.get(o.id)}
                          </SubmitButton>
                        </form>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

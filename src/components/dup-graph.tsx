"use client";

import clsx from "clsx";
import { ArrowRight, MapPin } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { mergeTwoMandisAction, relinkMandiNameAction, removeDuplicateMandiAction } from "@/app/actions";
import { SubmitButton } from "@/components/client";

export type GraphMandi = { id: string; name: string; district: string | null; postcode: string | null; hasLocation: boolean; source: string | null; keep: boolean };
export type GraphName = { id: string; raw: string; source: string; status: string; listings: number; mandiId: string | null };

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
/** One colour per mandi copy, so every line says which copy a name points at. */
const COLORS = ["#047857", "#0369a1", "#7c3aed", "#c2410c", "#be123c", "#0f766e"];

const NH = 52; // name node height
const NG = 8; // gap between name nodes
const MH = 150; // mandi node height
const MG = 12;

type Pending = { kind: "name"; name: GraphName; to: GraphMandi } | { kind: "copy" | "remove"; from: GraphMandi; to: GraphMandi };

/**
 * Link graph for one group of same-named mandis: mandi names on the left, the mandi copies on
 * the right, one line per link. Two ways to change it, both previewed on the graph (dashed
 * lines) before anything is saved:
 *  - click a mandi name, then the mandi it should point to (moves that one name);
 *  - click "Merge into another…" on a mandi, then the copy that keeps its names.
 */
export function DupGraph({ mandis, names, editor, canRemove, back }: { mandis: GraphMandi[]; names: GraphName[]; editor: boolean; canRemove: boolean; back: string }) {
  const [selName, setSelName] = useState<string | null>(null);
  const [mergeFrom, setMergeFrom] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);

  const idx = new Map(mandis.map((m, i) => [m.id, i]));
  const letter = (m: GraphMandi) => LETTERS[(idx.get(m.id) ?? 0) % 26];
  const colorOf = (id: string | null) => (id ? COLORS[(idx.get(id) ?? 0) % COLORS.length] : "#f59e0b");
  const label = (m: GraphMandi) => `${letter(m)} · ${m.name}${m.district ? `, ${m.district}` : " (no district)"}`;
  const namesOf = (id: string) => names.filter((n) => n.mandiId === id);
  const listingsOf = (id: string) => namesOf(id).reduce((n, x) => n + x.listings, 0);

  // Where each name will point if the pending change is saved.
  const movedTo = (n: GraphName): string | null =>
    pending?.kind === "name" && pending.name.id === n.id ? pending.to.id : pending?.kind !== "name" && pending && n.mandiId === pending.from.id ? pending.to.id : null;
  const effective = (n: GraphName) => movedTo(n) ?? n.mandiId;

  const nameY = (i: number) => i * (NH + NG) + NH / 2;
  const mandiY = (j: number) => j * (MH + MG) + MH / 2;
  const height = Math.max(names.length * (NH + NG) - NG, mandis.length * (MH + MG) - MG);
  const selected = names.find((n) => n.id === selName) ?? null;
  const from = mandis.find((m) => m.id === mergeFrom) ?? null;
  const main = mandis.find((m) => m.keep) ?? mandis[0];
  /** Two copies look like one place unless both name a district and the districts differ. */
  const sameDistrict = (a: GraphMandi, b: GraphMandi) => !a.district || !b.district || a.district.trim().toLowerCase() === b.district.trim().toLowerCase();
  const focus = pending ? null : selName ?? mergeFrom ?? hover;
  const lit = (n: GraphName) => !focus || focus === n.id || focus === n.mandiId;

  const reset = () => { setSelName(null); setMergeFrom(null); setPending(null); };
  const clickMandi = (m: GraphMandi) => {
    if (!editor || pending) return;
    if (selected && selected.mandiId !== m.id) setPending({ kind: "name", name: selected, to: m });
    else if (from && from.id !== m.id) setPending({ kind: "copy", from, to: m });
  };

  return (
    <div>
      {editor && (
        <div className="mb-3 text-xs">
          {pending ? (
            <Confirm pending={pending} back={back} canRemove={canRemove} label={label} namesOf={namesOf} listingsOf={listingsOf} onCancel={() => setPending(null)} />
          ) : from ? (
            <div className="flex flex-wrap items-center gap-2 rounded-lg bg-sky-50 px-3 py-2 text-sky-900">
              <span>
                Merging <b>{label(from)}</b> ({namesOf(from.id).length} name{namesOf(from.id).length === 1 ? "" : "s"}, {listingsOf(from.id)} listings).
                <b> Step 2: click the copy that should keep them.</b>
              </span>
              <button type="button" className="underline" onClick={reset}>Cancel</button>
            </div>
          ) : selected ? (
            <div className="flex flex-wrap items-center gap-2 rounded-lg bg-sky-50 px-3 py-2 text-sky-900">
              <span><b>{selected.raw}</b> ({selected.source}, {selected.listings} listings) selected. <b>Click the mandi it should point to.</b></span>
              <button type="button" className="underline" onClick={reset}>Clear</button>
            </div>
          ) : (
            <div className="rounded-lg bg-zinc-50 px-3 py-2 text-zinc-600">
              <b>Move one name:</b> click it on the left, then the mandi it belongs to. <b>Merge a copy:</b> press “Merge into A (main)” on the smaller copy. The main copy is the one with the most listings. You see a preview before anything is saved.
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-[minmax(0,1fr)_72px_minmax(0,1fr)] sm:grid-cols-[minmax(0,1fr)_120px_minmax(0,1fr)]">
        <div className="space-y-2" style={{ minHeight: height }}>
          {names.map((n) => {
            const to = movedTo(n);
            const target = mandis.find((m) => m.id === to);
            return (
              <button
                key={n.id}
                type="button"
                style={{ height: NH, borderLeftColor: colorOf(effective(n)) }}
                onMouseEnter={() => setHover(n.id)}
                onMouseLeave={() => setHover(null)}
                onClick={() => { if (editor && !pending) { setMergeFrom(null); setSelName(selName === n.id ? null : n.id); } }}
                className={clsx(
                  "block w-full rounded-lg border border-l-4 bg-white px-2.5 text-left transition",
                  selName === n.id ? "border-sky-500 ring-2 ring-sky-200" : "border-zinc-200 hover:border-zinc-300",
                  to && "border-dashed border-amber-400 bg-amber-50/60",
                  !lit(n) && !to && "opacity-40",
                  editor && "cursor-pointer",
                )}
              >
                <div className="truncate text-sm font-medium text-zinc-900">{n.raw}</div>
                <div className="flex items-center gap-1.5 truncate text-xs text-zinc-500">
                  {n.source} · <span className="tabular-nums">{n.listings}</span> listings
                  {target ? <span className="font-medium text-amber-800">→ will move to {letter(target)}</span> : !n.mandiId && <span className="rounded bg-amber-100 px-1 font-medium text-amber-800">not linked</span>}
                </div>
              </button>
            );
          })}
        </div>

        <svg className="h-full w-full" style={{ height }} viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" aria-hidden>
          {names.map((n, i) => {
            const target = effective(n);
            const j = target ? idx.get(target) ?? -1 : -1;
            if (j < 0) return null;
            const y1 = nameY(i);
            const y2 = mandiY(j);
            const preview = movedTo(n) !== null;
            const on = focus === n.id || focus === n.mandiId;
            return (
              <path
                key={n.id}
                d={`M0 ${y1} C 55 ${y1}, 45 ${y2}, 100 ${y2}`}
                fill="none"
                stroke={colorOf(target)}
                strokeWidth={preview || on ? 4 : Math.min(3, 1.5 + Math.log10(n.listings + 1) * 0.5)}
                strokeDasharray={preview ? "7 5" : undefined}
                strokeLinecap="round"
                opacity={preview ? 1 : lit(n) ? (on ? 1 : 0.65) : 0.12}
                vectorEffect="non-scaling-stroke"
              />
            );
          })}
        </svg>

        <div className="space-y-3">
          {mandis.map((m) => {
            const color = colorOf(m.id);
            const ns = namesOf(m.id);
            const total = listingsOf(m.id);
            const targetable = editor && !pending && ((!!selected && selected.mandiId !== m.id) || (!!from && from.id !== m.id));
            const isSource = from?.id === m.id || (!!pending && pending.kind !== "name" && pending.from.id === m.id);
            const isTarget = pending?.to.id === m.id;
            const dim = !targetable && !pending && !isSource && !!focus && focus !== m.id && !names.some((n) => n.id === focus && n.mandiId === m.id);
            const gain = pending ? (pending.kind === "name" ? pending.name.listings : listingsOf(pending.from.id)) : 0;
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
                  isSource && "border-dashed border-amber-400 bg-amber-50/60",
                  isTarget && "border-emerald-500 ring-2 ring-emerald-200",
                  m.keep && !targetable && !isTarget && !isSource && "bg-emerald-50/40",
                  dim && "opacity-40",
                )}
              >
                <div className="flex min-w-0 items-center gap-1.5">
                  <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-[10px] font-bold text-white" style={{ background: color }}>{letter(m)}</span>
                  <Link href={`/mandis/${m.id}`} onClick={(e) => (targetable ? e.preventDefault() : e.stopPropagation())} className="truncate text-sm font-semibold text-zinc-900 hover:underline">{m.name}</Link>
                  {m.keep && <span className="rounded bg-emerald-100 px-1 text-[11px] font-medium text-emerald-800">main</span>}
                  {targetable && <span className="ml-auto shrink-0 rounded bg-sky-600 px-1.5 text-[11px] font-medium text-white">{from ? "Keep names here" : "Link here"}</span>}
                  {isSource && <span className={clsx("ml-auto shrink-0 rounded px-1.5 text-[11px] font-medium text-white", pending?.kind === "remove" ? "bg-red-600" : "bg-amber-500")}>{pending?.kind === "remove" ? "Removing" : "Merging away"}</span>}
                  {isTarget && <span className="ml-auto shrink-0 rounded bg-emerald-600 px-1.5 text-[11px] font-medium text-white">Receives</span>}
                </div>
                <div className="mt-0.5 text-xs text-zinc-600">{m.district ?? <span className="text-zinc-400">no district</span>}{m.postcode ? ` · ${m.postcode}` : ""}</div>
                <div className="mt-0.5 flex items-center gap-2 text-xs text-zinc-500">
                  <span className={clsx("inline-flex items-center gap-0.5", !m.hasLocation && "text-zinc-300")}><MapPin className="h-3 w-3" />{m.hasLocation ? "location" : "no location"}</span>
                  <span>{m.source ?? "unknown"}</span>
                </div>
                <div className="mt-0.5 text-xs font-medium text-zinc-800 tabular-nums">
                  {ns.length} name{ns.length === 1 ? "" : "s"} · {total} listings
                  {isTarget && <span className="text-emerald-700"> → {total + gain} after</span>}
                  {pending && pending.kind !== "name" && pending.from.id === m.id && <span className="text-amber-700"> → {pending.kind === "remove" ? "removed" : "0 after"}</span>}
                </div>
                {editor && mandis.length > 1 && !pending && !from && !selected && (
                  m.keep ? (
                    <div className="mt-1.5 text-xs text-emerald-700">Main copy: the others merge into this one.</div>
                  ) : ns.length === 0 ? (
                    <div className="mt-1.5 text-xs text-zinc-400">
                      No names linked: nothing to merge.
                      {canRemove && (
                        <button type="button" className="ml-2 font-medium text-red-700 hover:underline" onClick={(e) => { e.stopPropagation(); setSelName(null); setMergeFrom(null); setPending({ kind: "remove", from: m, to: main }); }}>
                          Remove from mandi list
                        </button>
                      )}
                    </div>
                  ) : (
                    <div className="mt-1.5 space-y-1" onClick={(e) => e.stopPropagation()}>
                      <button
                        type="button"
                        className={clsx("inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-white", sameDistrict(m, main) ? "bg-emerald-700 hover:bg-emerald-800" : "bg-amber-600 hover:bg-amber-700")}
                        title={`Move this copy's ${ns.length} name(s) onto ${main.name}${main.district ? `, ${main.district}` : ""}`}
                        onClick={() => { setSelName(null); setMergeFrom(null); setPending({ kind: "copy", from: m, to: main }); }}
                      >
                        Merge into {letter(main)} (main) <ArrowRight className="h-3 w-3" />
                      </button>
                      <div className={clsx("text-[11px]", sameDistrict(m, main) ? "text-zinc-500" : "font-medium text-amber-700")}>
                        {sameDistrict(m, main) ? `Looks like the same place as ${letter(main)}.` : `Different district from ${letter(main)}: may be a different place.`}{" "}
                        <button type="button" className="underline" onClick={() => { setSelName(null); setMergeFrom(m.id); }}>merge into another…</button>
                      </div>
                    </div>
                  )
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** Plain-words summary of what will change, with before/after numbers, and the save button. */
function Confirm({ pending, back, canRemove, label, namesOf, listingsOf, onCancel }: {
  pending: Pending;
  back: string;
  canRemove: boolean;
  label: (m: GraphMandi) => string;
  namesOf: (id: string) => GraphName[];
  listingsOf: (id: string) => number;
  onCancel: () => void;
}) {
  const to = pending.to;
  const moving = pending.kind === "name" ? [pending.name] : namesOf(pending.from.id);
  const listings = moving.reduce((n, x) => n + x.listings, 0);
  const fromMandi = pending.kind === "name" ? null : pending.from;
  return (
    <form action={pending.kind === "remove" ? removeDuplicateMandiAction : pending.kind === "copy" ? mergeTwoMandisAction : relinkMandiNameAction} className={clsx("space-y-2 rounded-lg px-3 py-2.5", pending.kind === "remove" ? "bg-red-50 text-red-950" : "bg-amber-50 text-amber-950")}>
      <input type="hidden" name="back" value={back} />
      {pending.kind !== "name" ? (
        <>
          <input type="hidden" name="fromId" value={pending.from.id} />
          <input type="hidden" name="intoId" value={to.id} />
        </>
      ) : (
        <>
          <input type="hidden" name="id" value={pending.name.id} />
          <input type="hidden" name="mandiId" value={to.id} />
        </>
      )}
      {pending.kind === "remove" ? (
        <div className="text-sm">
          Remove <b>{label(pending.from)}</b> from the <b>available_mandi</b> list. No mandi name uses it. A copy of the record is saved so it can be restored. <b>v1 loses it too</b>, because the list is shared.
        </div>
      ) : (
      <div className="text-sm">
        Move <b>{moving.length} name{moving.length === 1 ? "" : "s"}</b> ({moving.map((n) => `“${n.raw}”`).join(", ")}) with <b>{listings} listings</b>
        {fromMandi ? <> from <b>{label(fromMandi)}</b></> : null} <ArrowRight className="mx-0.5 inline h-4 w-4" /> <b>{label(to)}</b>
      </div>
      )}
      {pending.kind !== "remove" && (
        <ul className="list-disc space-y-0.5 pl-5">
          <li>{label(to)}: {listingsOf(to.id)} → <b>{listingsOf(to.id) + listings} listings</b></li>
          {fromMandi && <li>{label(fromMandi)}: {listingsOf(fromMandi.id)} → <b>0 listings</b> (stays in the shared mandi list unless you tick the box below)</li>}
          <li>Other copies are not changed.</li>
        </ul>
      )}
      {pending.kind === "copy" && canRemove && (
        <label className="flex items-center gap-2 font-medium text-red-800">
          <input type="checkbox" name="remove" /> Also remove {label(pending.from)} from the available_mandi list afterwards (a copy is kept; v1 loses it too)
        </label>
      )}
      <div className="flex gap-2">
        <SubmitButton className={pending.kind === "remove" ? "btn-danger" : "btn-primary"}>{pending.kind === "remove" ? "Yes, remove it" : "Yes, move them"}</SubmitButton>
        <button type="button" className="btn-secondary" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

"use client";

import clsx from "clsx";
import { ArrowRight, ExternalLink, MapPin } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { mergeTwoMandisAction, relinkMandiNameAction, removeDuplicateMandiAction } from "@/app/actions";
import { SubmitButton } from "@/components/client";

export type GraphMandi = {
  id: string; name: string; district: string | null; postcode: string | null; source: string | null; keep: boolean;
  lat: number | null; lon: number | null; createdAt: string | null; updatedAt: string | null; aliases: string[];
};
export type GraphName = { id: string; raw: string; source: string; status: string; listings: number; mandiId: string | null };

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
/** One colour per mandi copy, so every line says which copy a name points at. */
const COLORS = ["#047857", "#0369a1", "#7c3aed", "#c2410c", "#be123c", "#0f766e"];

const NH = 52; // name node height
const NG = 8; // gap between name nodes
const MH = 92; // mandi node height
const MG = 12;

type Sel = { type: "mandi" | "name"; id: string };
type Pending = { kind: "name"; name: GraphName; to: GraphMandi } | { kind: "copy" | "remove"; from: GraphMandi; to: GraphMandi };

/**
 * Link graph for one group of same-named mandis: mandi names on the left, the mandi copies on
 * the right, one line per link. Cards only show and select. Click any mandi or name and the
 * panel underneath shows its details and the same actions for every one, always with a
 * preview (dashed lines) and a plain-words summary before anything is saved.
 */
export function DupGraph({ mandis, names, editor, canRemove, removeBlocked, back }: {
  mandis: GraphMandi[]; names: GraphName[]; editor: boolean; canRemove: boolean; removeBlocked: string | null; back: string;
}) {
  const [sel, setSel] = useState<Sel | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [target, setTarget] = useState<string>("");
  const panel = useRef<HTMLDivElement>(null);

  const idx = new Map(mandis.map((m, i) => [m.id, i]));
  const letter = (m: GraphMandi) => LETTERS[(idx.get(m.id) ?? 0) % 26];
  const colorOf = (id: string | null) => (id ? COLORS[(idx.get(id) ?? 0) % COLORS.length] : "#f59e0b");
  const label = (m: GraphMandi) => `${letter(m)} · ${m.name}${m.district ? `, ${m.district}` : " (no district)"}`;
  const namesOf = (id: string) => names.filter((n) => n.mandiId === id);
  const listingsOf = (id: string) => namesOf(id).reduce((n, x) => n + x.listings, 0);

  // Where each name will point if the pending change is saved.
  const movedTo = (n: GraphName): string | null =>
    pending?.kind === "name" ? (pending.name.id === n.id ? pending.to.id : null) : pending && n.mandiId === pending.from.id ? pending.to.id : null;
  const effective = (n: GraphName) => movedTo(n) ?? n.mandiId;

  const nameY = (i: number) => i * (NH + NG) + NH / 2;
  const mandiY = (j: number) => j * (MH + MG) + MH / 2;
  const height = Math.max(names.length * (NH + NG) - NG, mandis.length * (MH + MG) - MG);
  const selMandi = sel?.type === "mandi" ? mandis.find((m) => m.id === sel.id) ?? null : null;
  const selName = sel?.type === "name" ? names.find((n) => n.id === sel.id) ?? null : null;
  const focus = pending ? null : sel?.id ?? hover;
  const lit = (n: GraphName) => !focus || focus === n.id || focus === n.mandiId;

  /** Best default target for the selected item: the main copy, or the next best one. */
  const defaultTarget = (s: Sel | null) => {
    if (!s) return "";
    const own = s.type === "mandi" ? s.id : names.find((n) => n.id === s.id)?.mandiId;
    return (mandis.find((m) => m.id !== own && m.keep) ?? mandis.find((m) => m.id !== own))?.id ?? "";
  };
  const choose = (s: Sel | null) => {
    setPending(null);
    setSel(sel && s && sel.id === s.id ? null : s);
    setTarget(defaultTarget(sel && s && sel.id === s.id ? null : s));
  };
  useEffect(() => { if (sel) panel.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }); }, [sel?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const targetMandi = mandis.find((m) => m.id === target) ?? null;

  return (
    <div>
      <div className="grid grid-cols-[minmax(0,1fr)_72px_minmax(0,1fr)] sm:grid-cols-[minmax(0,1fr)_120px_minmax(0,1fr)]">
        <div className="space-y-2" style={{ minHeight: height }}>
          {names.map((n) => {
            const to = movedTo(n);
            const dest = mandis.find((m) => m.id === to);
            return (
              <button
                key={n.id}
                type="button"
                style={{ height: NH, borderLeftColor: colorOf(effective(n)) }}
                onMouseEnter={() => setHover(n.id)}
                onMouseLeave={() => setHover(null)}
                onClick={() => choose({ type: "name", id: n.id })}
                className={clsx(
                  "block w-full cursor-pointer rounded-lg border border-l-4 bg-white px-2.5 text-left transition",
                  sel?.id === n.id ? "border-sky-500 ring-2 ring-sky-200" : "border-zinc-200 hover:border-zinc-300",
                  to && "border-dashed border-amber-400 bg-amber-50/60",
                  !lit(n) && !to && "opacity-40",
                )}
              >
                <div className="truncate text-sm font-medium text-zinc-900">{n.raw}</div>
                <div className="flex items-center gap-1.5 truncate text-xs text-zinc-500">
                  {n.source} · <span className="tabular-nums">{n.listings}</span> listings
                  {dest ? <span className="font-medium text-amber-800">→ will move to {letter(dest)}</span> : !n.mandiId && <span className="rounded bg-amber-100 px-1 font-medium text-amber-800">not linked</span>}
                </div>
              </button>
            );
          })}
        </div>

        <svg className="h-full w-full" style={{ height }} viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" aria-hidden>
          {names.map((n, i) => {
            const dest = effective(n);
            const j = dest ? idx.get(dest) ?? -1 : -1;
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
                stroke={colorOf(dest)}
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
            const ns = namesOf(m.id);
            const total = listingsOf(m.id);
            const isSource = !!pending && pending.kind !== "name" && pending.from.id === m.id;
            const isTarget = pending?.to.id === m.id;
            const gain = pending ? (pending.kind === "name" ? pending.name.listings : listingsOf(pending.from.id)) : 0;
            const dim = !pending && !!focus && focus !== m.id && !names.some((n) => n.id === focus && n.mandiId === m.id);
            return (
              <div
                key={m.id}
                role="button"
                tabIndex={0}
                style={{ height: MH, borderLeftColor: colorOf(m.id) }}
                onMouseEnter={() => setHover(m.id)}
                onMouseLeave={() => setHover(null)}
                onClick={() => choose({ type: "mandi", id: m.id })}
                onKeyDown={(e) => { if (e.key === "Enter") choose({ type: "mandi", id: m.id }); }}
                className={clsx(
                  "cursor-pointer overflow-hidden rounded-lg border border-l-4 bg-white p-2.5 transition",
                  sel?.id === m.id ? "border-sky-500 ring-2 ring-sky-200" : "border-zinc-200 hover:border-zinc-300",
                  isSource && "border-dashed border-amber-400 bg-amber-50/60",
                  isTarget && "border-emerald-500 ring-2 ring-emerald-200",
                  dim && "opacity-40",
                )}
              >
                <div className="flex min-w-0 items-center gap-1.5">
                  <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-[10px] font-bold text-white" style={{ background: colorOf(m.id) }}>{letter(m)}</span>
                  <span className="truncate text-sm font-semibold text-zinc-900">{m.name}</span>
                  {m.keep && <span className="rounded bg-emerald-100 px-1 text-[11px] font-medium text-emerald-800">main</span>}
                  {isSource && <span className={clsx("ml-auto shrink-0 rounded px-1.5 text-[11px] font-medium text-white", pending?.kind === "remove" ? "bg-red-600" : "bg-amber-500")}>{pending?.kind === "remove" ? "Removing" : "Merging away"}</span>}
                  {isTarget && <span className="ml-auto shrink-0 rounded bg-emerald-600 px-1.5 text-[11px] font-medium text-white">Receives</span>}
                </div>
                <div className="mt-0.5 truncate text-xs text-zinc-600">{m.district ?? <span className="text-zinc-400">no district</span>}{m.postcode ? ` · ${m.postcode}` : ""}</div>
                <div className="mt-1 text-xs font-medium text-zinc-800 tabular-nums">
                  {ns.length} name{ns.length === 1 ? "" : "s"} · {total} listings
                  {isTarget && <span className="text-emerald-700"> → {total + gain} after</span>}
                  {isSource && <span className="text-amber-700"> → {pending?.kind === "remove" ? "removed" : "0 after"}</span>}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div ref={panel} className="mt-4 scroll-mb-4">
        {!sel ? (
          <div className="rounded-lg bg-zinc-50 px-3 py-3 text-xs text-zinc-600">Click any mandi name on the left or mandi on the right to see its details and what you can do with it.</div>
        ) : (
          <div className="rounded-lg border border-zinc-200 bg-white">
            {selMandi && (
              <MandiPanel
                m={selMandi} letter={letter(selMandi)} color={colorOf(selMandi.id)} names={namesOf(selMandi.id)} listings={listingsOf(selMandi.id)}
                others={mandis.filter((o) => o.id !== selMandi.id)} target={targetMandi} setTarget={setTarget} label={label} letterOf={letter}
                editor={editor} canRemove={canRemove} removeBlocked={removeBlocked} pending={pending} setPending={setPending}
                onPickName={(id) => choose({ type: "name", id })} back={back} namesOf={namesOf} listingsOf={listingsOf}
              />
            )}
            {selName && (
              <NamePanel
                n={selName} current={mandis.find((m) => m.id === selName.mandiId) ?? null} others={mandis.filter((o) => o.id !== selName.mandiId)}
                target={targetMandi} setTarget={setTarget} label={label} letter={letter} editor={editor} pending={pending} setPending={setPending}
                back={back} namesOf={namesOf} listingsOf={listingsOf} color={colorOf(selName.mandiId)}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

const Row = ({ k, children }: { k: string; children: React.ReactNode }) => (
  <div className="flex gap-2 text-xs"><dt className="w-20 shrink-0 text-zinc-500">{k}</dt><dd className="min-w-0 break-words text-zinc-900">{children}</dd></div>
);

function TargetSelect({ others, target, setTarget, label, disabled }: { others: GraphMandi[]; target: GraphMandi | null; setTarget: (id: string) => void; label: (m: GraphMandi) => string; disabled?: boolean }) {
  return (
    <select className="input max-w-full text-sm" value={target?.id ?? ""} disabled={disabled} onChange={(e) => setTarget(e.target.value)} aria-label="Target mandi">
      {others.map((o) => <option key={o.id} value={o.id}>{label(o)}{o.keep ? " (main)" : ""}</option>)}
    </select>
  );
}

/** Details of one mandi, the names connected to it, and the same two actions for every mandi. */
function MandiPanel({ m, letter, color, names, listings, others, target, setTarget, label, letterOf, editor, canRemove, removeBlocked, pending, setPending, onPickName, back, namesOf, listingsOf }: {
  m: GraphMandi; letter: string; color: string; names: GraphName[]; listings: number; others: GraphMandi[]; target: GraphMandi | null;
  setTarget: (id: string) => void; label: (m: GraphMandi) => string; letterOf: (m: GraphMandi) => string; editor: boolean; canRemove: boolean;
  removeBlocked: string | null; pending: Pending | null; setPending: (p: Pending | null) => void; onPickName: (id: string) => void; back: string;
  namesOf: (id: string) => GraphName[]; listingsOf: (id: string) => number;
}) {
  const n = names.length;
  const mapUrl = m.lat !== null && m.lon !== null ? `https://www.google.com/maps?q=${m.lat},${m.lon}` : null;
  const same = (a: GraphMandi | null) => !a || !a.district || !m.district || a.district.trim().toLowerCase() === m.district.trim().toLowerCase();
  return (
    <div className="p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex h-5 w-5 items-center justify-center rounded text-xs font-bold text-white" style={{ background: color }}>{letter}</span>
        <h3 className="text-base font-semibold text-zinc-900">{m.name}</h3>
        {m.keep && <span className="rounded bg-emerald-100 px-1.5 text-xs font-medium text-emerald-800">main copy (most listings)</span>}
        <Link href={`/mandis/${m.id}`} className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-emerald-700 hover:underline">Open mandi page <ExternalLink className="h-3 w-3" /></Link>
      </div>

      <div className="mt-3 grid gap-x-8 gap-y-1.5 sm:grid-cols-2">
        <dl className="space-y-1.5">
          <Row k="District">{m.district ?? <span className="text-zinc-400">not set</span>}</Row>
          <Row k="Postcode">{m.postcode ?? <span className="text-zinc-400">not set</span>}</Row>
          <Row k="Location">{mapUrl ? <a className="text-emerald-700 hover:underline" target="_blank" rel="noreferrer" href={mapUrl}><MapPin className="mr-0.5 inline h-3 w-3" />{m.lat?.toFixed(4)}, {m.lon?.toFixed(4)}</a> : <span className="text-zinc-400">not set</span>}</Row>
        </dl>
        <dl className="space-y-1.5">
          <Row k="Record source">{m.source ?? "unknown"}</Row>
          <Row k="Updated">{(m.updatedAt ?? m.createdAt)?.slice(0, 10) ?? "—"}</Row>
          <Row k="Record id"><span className="font-mono">{m.id}</span></Row>
        </dl>
      </div>
      {m.aliases.length > 0 && <div className="mt-1.5 text-xs text-zinc-500">Other names: {m.aliases.join(", ")}</div>}

      <div className="mt-4 text-xs font-medium tracking-wide text-zinc-500 uppercase">Mandi names connected to it ({n} · {listings} listings)</div>
      {n === 0 ? (
        <div className="mt-1 text-sm text-zinc-500">No mandi name uses this record, so no price is attached to it.</div>
      ) : (
        <ul className="mt-1 divide-y divide-zinc-100 rounded-lg border border-zinc-100">
          {names.map((x) => (
            <li key={x.id} className="flex items-center gap-2 px-3 py-1.5 text-sm">
              <span className="min-w-0 flex-1 truncate"><b className="font-medium text-zinc-900">{x.raw}</b> <span className="text-xs text-zinc-500">{x.source} · {x.listings} listings · {x.status}</span></span>
              {editor && <button type="button" className="shrink-0 text-xs font-medium text-emerald-700 hover:underline" onClick={() => onPickName(x.id)}>Connect elsewhere…</button>}
            </li>
          ))}
        </ul>
      )}

      {editor && (
        <div className="mt-4 border-t border-zinc-100 pt-4">
          <div className="text-xs font-medium tracking-wide text-zinc-500 uppercase">What do you want to do with {letter} · {m.name}?</div>
          {pending ? (
            <div className="mt-2"><Confirm pending={pending} back={back} label={label} namesOf={namesOf} listingsOf={listingsOf} onCancel={() => setPending(null)} /></div>
          ) : (
            <div className="mt-2 space-y-3">
              <div>
                <label className="label">Target mandi (the one that keeps the names)</label>
                <TargetSelect others={others} target={target} setTarget={setTarget} label={label} />
                {target && !same(target) && <div className="mt-1 text-xs font-medium text-amber-700">Different district from {letter}: they may be different places.</div>}
                {target && same(target) && <div className="mt-1 text-xs text-zinc-500">Looks like the same place as {letterOf(target)}.</div>}
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" className="btn-primary" disabled={!target || n === 0} onClick={() => target && setPending({ kind: "copy", from: m, to: target })}>
                  1. Move its {n} name{n === 1 ? "" : "s"} to {target ? letterOf(target) : "target"}
                </button>
                <button type="button" className="btn-danger" disabled={!target || !canRemove} onClick={() => target && setPending({ kind: "remove", from: m, to: target })}>
                  2. {n ? `Move its names, then remove ${letter}` : `Remove ${letter} from the mandi list`}
                </button>
              </div>
              <ul className="list-disc space-y-0.5 pl-5 text-xs text-zinc-500">
                <li><b>1</b> keeps the record in the mandi list; it just no longer has any names.{n === 0 && " (Nothing to move: no names are linked.)"}</li>
                <li><b>2</b> deletes the record from the shared <code>available_mandi</code> list (a copy is saved so it can be restored).{removeBlocked && <span className="font-medium text-red-700"> Not available: {removeBlocked}</span>}</li>
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Details of one mandi name and the one action: connect it to a different mandi. */
function NamePanel({ n, current, others, target, setTarget, label, letter, editor, pending, setPending, back, namesOf, listingsOf, color }: {
  n: GraphName; current: GraphMandi | null; others: GraphMandi[]; target: GraphMandi | null; setTarget: (id: string) => void;
  label: (m: GraphMandi) => string; letter: (m: GraphMandi) => string; editor: boolean; pending: Pending | null; setPending: (p: Pending | null) => void;
  back: string; namesOf: (id: string) => GraphName[]; listingsOf: (id: string) => number; color: string;
}) {
  return (
    <div className="p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium tracking-wide text-zinc-500 uppercase">Mandi name from {n.source}</span>
        <Link href={`/mandi-links?status=all&q=${encodeURIComponent(n.raw)}&id=${n.id}`} className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-emerald-700 hover:underline">Open in Mandi names <ExternalLink className="h-3 w-3" /></Link>
      </div>
      <h3 className="mt-1 text-base font-semibold break-words text-zinc-900">{n.raw}</h3>
      <dl className="mt-2 space-y-1.5">
        <Row k="Listings">{n.listings} crop listings use this name</Row>
        <Row k="Status">{n.status}</Row>
        <Row k="Connected to">{current ? <span><span className="mr-1 inline-flex h-4 w-4 items-center justify-center rounded text-[10px] font-bold text-white" style={{ background: color }}>{letter(current)}</span>{label(current)}</span> : <span className="font-medium text-amber-700">no mandi yet</span>}</Row>
      </dl>
      {editor && (
        <div className="mt-4 border-t border-zinc-100 pt-4">
          <div className="text-xs font-medium tracking-wide text-zinc-500 uppercase">Connect “{n.raw}” to a mandi</div>
          {pending ? (
            <div className="mt-2"><Confirm pending={pending} back={back} label={label} namesOf={namesOf} listingsOf={listingsOf} onCancel={() => setPending(null)} /></div>
          ) : (
            <div className="mt-2 space-y-3">
              <TargetSelect others={others} target={target} setTarget={setTarget} label={label} />
              <button type="button" className="btn-primary" disabled={!target} onClick={() => target && setPending({ kind: "name", name: n, to: target })}>
                Connect this name to {target ? letter(target) : "target"}
              </button>
              <p className="text-xs text-zinc-500">Only this one name moves, with its {n.listings} listings. Nothing is saved until you confirm.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Plain-words summary of what will change, with before/after numbers, and the save button. */
function Confirm({ pending, back, label, namesOf, listingsOf, onCancel }: {
  pending: Pending;
  back: string;
  label: (m: GraphMandi) => string;
  namesOf: (id: string) => GraphName[];
  listingsOf: (id: string) => number;
  onCancel: () => void;
}) {
  const to = pending.to;
  const moving = pending.kind === "name" ? [pending.name] : namesOf(pending.from.id);
  const listings = moving.reduce((n, x) => n + x.listings, 0);
  const fromMandi = pending.kind === "name" ? null : pending.from;
  const remove = pending.kind === "remove";
  return (
    <form action={remove ? removeDuplicateMandiAction : pending.kind === "copy" ? mergeTwoMandisAction : relinkMandiNameAction} className={clsx("space-y-2 rounded-lg px-3 py-2.5 text-xs", remove ? "bg-red-50 text-red-950" : "bg-amber-50 text-amber-950")}>
      <input type="hidden" name="back" value={back} />
      {fromMandi ? (
        <>
          <input type="hidden" name="fromId" value={fromMandi.id} />
          <input type="hidden" name="intoId" value={to.id} />
        </>
      ) : (
        <>
          <input type="hidden" name="id" value={pending.kind === "name" ? pending.name.id : ""} />
          <input type="hidden" name="mandiId" value={to.id} />
        </>
      )}
      <div className="text-sm">
        {moving.length > 0 ? (
          <>Move <b>{moving.length} name{moving.length === 1 ? "" : "s"}</b> ({moving.map((x) => `“${x.raw}”`).join(", ")}) with <b>{listings} listings</b>{fromMandi ? <> from <b>{label(fromMandi)}</b></> : null} <ArrowRight className="mx-0.5 inline h-4 w-4" /> <b>{label(to)}</b>.</>
        ) : (
          <>No mandi name uses <b>{fromMandi && label(fromMandi)}</b>, so nothing moves.</>
        )}
        {remove && fromMandi && <> Then <b>remove {label(fromMandi)} from the available_mandi list</b>. A copy of the record is saved so it can be restored. <b>v1 loses it too</b>, because the list is shared.</>}
      </div>
      <ul className="list-disc space-y-0.5 pl-5">
        {moving.length > 0 && <li>{label(to)}: {listingsOf(to.id)} → <b>{listingsOf(to.id) + listings} listings</b></li>}
        {fromMandi && moving.length > 0 && <li>{label(fromMandi)}: {listingsOf(fromMandi.id)} → <b>0 listings</b>{remove ? " and the record is deleted" : " (the record stays in the mandi list, unused)"}</li>}
        <li>Other copies are not changed.</li>
      </ul>
      <div className="flex gap-2">
        <SubmitButton className={remove ? "btn-danger" : "btn-primary"}>{remove ? "Yes, do it" : "Yes, move them"}</SubmitButton>
        <button type="button" className="btn-secondary" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

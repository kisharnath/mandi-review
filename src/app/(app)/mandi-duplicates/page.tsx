import clsx from "clsx";
import Link from "next/link";
import { autoMergeDuplicateMandisAction, mergeDuplicateMandisAction } from "@/app/actions";
import { FilterSelect, SearchBox, SubmitButton, Tabs } from "@/components/client";
import { Badge, Empty, Flash, PageHeader } from "@/components/ui";
import { canEdit, requireUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { first, fmtNumber, titleCase } from "@/lib/format";
import { findDuplicateGroups, sumListings, type DupGroup } from "@/lib/mandi-duplicates";
import { stateNames } from "@/lib/stats";

export const maxDuration = 60;
const PAGE_SIZE = 40;

const STATUS_PILL: Record<string, "green" | "red" | "amber"> = { approved: "green", rejected: "red", pending: "amber" };

export default async function MandiDuplicatesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const user = await requireUser();
  const editor = canEdit(user);
  const tab = first(sp.tab) || "merge";
  const state = first(sp.state);
  const q = first(sp.q).trim().toLowerCase();
  const names = await stateNames();
  const all = await findDuplicateGroups(await getDb(), { state: state || undefined });

  const needsMerge = all.filter((g) => g.safe && g.linkedCopies > 1);
  const differ = all.filter((g) => !g.safe);
  const unused = all.filter((g) => g.safe && g.linkedCopies <= 1);
  const shown = (tab === "differ" ? differ : tab === "unused" ? unused : needsMerge).filter(
    (g) => !q || g.members.some((m) => m.name.toLowerCase().includes(q) || m.links.some((l) => l.raw_name.toLowerCase().includes(q))),
  );
  const page = shown.slice(0, PAGE_SIZE);

  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) if (typeof v === "string" && v && k !== "msg" && k !== "err") qs.set(k, v);
  const back = `/mandi-duplicates?${qs}`;
  const autoNames = needsMerge.reduce((n, g) => n + g.members.slice(1).reduce((m, x) => m + x.links.length, 0), 0);

  return (
    <>
      <PageHeader
        title="Duplicate mandis"
        description="Mandis in the same state with the same name once spelling noise (brackets, APMC, “mandi”) is removed. When mandi names are linked to more than one copy, one place's prices are split between them."
      />
      <Flash msg={first(sp.msg)} err={first(sp.err)} />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Tabs
          param="tab"
          tabs={[
            { value: "merge", label: "Needs merging", count: needsMerge.length },
            { value: "differ", label: "Different districts", count: differ.length },
            { value: "unused", label: "Unused copies", count: unused.length },
          ]}
        />
        <FilterSelect param="state" label="State" options={Object.entries(names).sort((a, b) => a[1].localeCompare(b[1])).map(([code, n]) => ({ value: code, label: titleCase(n) }))} />
        <SearchBox placeholder="Search mandi or linked name…" />
      </div>

      <p className="mb-4 text-xs text-zinc-500">
        {tab === "merge" && "Copies in the same district (or with no district) that each have names linked. Safe to merge: the most complete copy is kept."}
        {tab === "differ" && "Same name but different districts: these may be different places. Check each before merging, or leave them."}
        {tab === "unused" && "Only one copy has names linked, so prices are not split. The extra copies are harmless; they come from the shared mandi list and are not deleted here."}
      </p>

      {editor && tab === "merge" && needsMerge.length > 0 && (
        <div className="card mb-4 p-4 text-sm">
          <div className="font-medium text-zinc-900">
            {fmtNumber(needsMerge.length)} duplicate mandis can be merged automatically ({fmtNumber(autoNames)} mandi names move)
          </div>
          <p className="mt-1 text-xs text-zinc-600">Each group keeps its most complete copy. Moved names go to Double-check. The shared mandi list is not changed.</p>
          <form action={autoMergeDuplicateMandisAction} className="mt-3">
            <input type="hidden" name="back" value={back} />
            <input type="hidden" name="state" value={state} />
            <SubmitButton confirm={`Merge ${needsMerge.length} duplicate mandis? ${autoNames} mandi names will point at the kept copy.`}>Merge all {fmtNumber(needsMerge.length)}</SubmitButton>
          </form>
        </div>
      )}

      {page.length === 0 ? (
        <Empty title="No duplicates here">Nothing matches this tab and filter.</Empty>
      ) : (
        <div className="space-y-4">
          {page.map((g) => (
            <GroupCard key={`${g.stateCode}|${g.key}`} g={g} back={back} editor={editor} stateLabel={titleCase(names[g.stateCode] ?? g.stateCode.replace(/^\?/, ""))} />
          ))}
          {shown.length > page.length && <p className="text-xs text-zinc-500">Showing {page.length} of {fmtNumber(shown.length)}. Narrow with the state filter or search.</p>}
        </div>
      )}
    </>
  );
}

function GroupCard({ g, back, editor, stateLabel }: { g: DupGroup; back: string; editor: boolean; stateLabel: string }) {
  const main = g.members[0];
  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-zinc-100 px-4 py-3">
        <h2 className="font-semibold text-zinc-900">{titleCase(main.name)}</h2>
        <span className="text-xs text-zinc-500">{stateLabel} · {g.members.length} copies · {fmtNumber(sumListings(g))} listings</span>
        {g.linkedCopies > 1 && <Badge tone="amber" title="Names are linked to more than one copy">Prices split across {g.linkedCopies} copies</Badge>}
        {!g.safe && <Badge tone="red" title="The copies name different districts">Different districts</Badge>}
        {g.waiting.length > 0 && (
          <Badge tone="blue" title={g.waiting.map((w) => `${w.raw_name} (${w.source})`).join(", ")}>{g.waiting.length} pending name{g.waiting.length === 1 ? "" : "s"} match</Badge>
        )}
      </div>
      <ul className="divide-y divide-zinc-100">
        {g.members.map((m, i) => (
          <li key={String(m._id)} className={clsx("px-4 py-3", i === 0 && "bg-emerald-50/40")}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <Link href={`/mandis/${String(m._id)}`} className="font-medium text-emerald-800 hover:underline">{titleCase(m.name)}</Link>
                  {i === 0 && <Badge tone="green">Keep (most complete)</Badge>}
                </div>
                <div className="mt-0.5 text-xs text-zinc-500">
                  {m.district ? `District: ${titleCase(m.district)}` : "No district"} · {m.postcode ? `Postcode ${m.postcode}` : "No postcode"} · {m.location ? "Has location" : "No location"} · Source: {m.source ?? "unknown"}
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
                  {m.links.length === 0 ? (
                    <span className="text-zinc-400">No mandi names linked: not used by any price.</span>
                  ) : (
                    m.links.map((l) => (
                      <Link
                        key={String(l._id)}
                        href={`/mandi-links?status=all&q=${encodeURIComponent(l.raw_name)}&id=${String(l._id)}`}
                        className="inline-flex items-center gap-1 rounded-full bg-zinc-100 px-2 py-0.5 text-zinc-700 hover:bg-emerald-50 hover:text-emerald-800"
                      >
                        {l.raw_name} · {l.source} · <span className="tabular-nums">{fmtNumber(l.listings ?? 0)}</span>
                        <span className={clsx("h-1.5 w-1.5 rounded-full", STATUS_PILL[l.status] === "green" ? "bg-emerald-500" : STATUS_PILL[l.status] === "red" ? "bg-red-500" : "bg-amber-500")} title={titleCase(l.status)} />
                      </Link>
                    ))
                  )}
                </div>
              </div>
              {editor && g.members.length > 1 && (
                <form action={mergeDuplicateMandisAction} className="shrink-0">
                  <input type="hidden" name="back" value={back} />
                  <input type="hidden" name="intoId" value={String(m._id)} />
                  <SubmitButton
                    className={i === 0 ? "btn-primary" : "btn-secondary"}
                    confirm={`Move every name linked to the other ${g.members.length - 1} cop${g.members.length === 2 ? "y" : "ies"} onto this one (${titleCase(m.name)}${m.district ? `, ${titleCase(m.district)}` : ""})?`}
                  >
                    {i === 0 ? "Merge others into this" : "Keep this one instead"}
                  </SubmitButton>
                </form>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

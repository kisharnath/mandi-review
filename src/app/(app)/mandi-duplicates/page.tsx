import { autoMergeDuplicateMandisAction, autoRemoveUnusedMandisAction } from "@/app/actions";
import { DupGraph, type GraphMandi, type GraphName } from "@/components/dup-graph";
import { FilterSelect, SearchBox, SubmitButton, Tabs } from "@/components/client";
import { Badge, Empty, Flash, PageHeader } from "@/components/ui";
import { canEdit, requireUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { first, fmtNumber, titleCase } from "@/lib/format";
import { findDuplicateGroups, MANDI_DELETE_ENABLED, removableCopies, sumListings, type DupGroup } from "@/lib/mandi-duplicates";
import { stateNames } from "@/lib/stats";

export const maxDuration = 60;
const PAGE_SIZE = 40;

export default async function MandiDuplicatesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const user = await requireUser();
  const editor = canEdit(user);
  const canRemove = MANDI_DELETE_ENABLED && user.role === "admin";
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
  const removable = removableCopies(all).length;

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
        {tab === "merge" && "Copies in the same district (or with no district) that each have names linked. Safe to merge: the copy with the most listings is kept."}
        {tab === "differ" && "Same name but different districts: these may be different places. Check each before merging, or leave them."}
        {tab === "unused" && "Only one copy has names linked, so prices are not split. The extra copies are harmless; they come from the shared mandi list and are not deleted here."}
      </p>

      {editor && tab === "merge" && needsMerge.length > 0 && (
        <div className="card mb-4 p-4 text-sm">
          <div className="font-medium text-zinc-900">
            {fmtNumber(needsMerge.length)} duplicate mandis can be merged automatically ({fmtNumber(autoNames)} mandi names move)
          </div>
          <p className="mt-1 text-xs text-zinc-600">Each group keeps the copy with the most listings. Moved names go to Double-check. The shared mandi list is not changed.</p>
          <form action={autoMergeDuplicateMandisAction} className="mt-3">
            <input type="hidden" name="back" value={back} />
            <input type="hidden" name="state" value={state} />
            <SubmitButton confirm={`Merge ${needsMerge.length} duplicate mandis? ${autoNames} mandi names will point at the kept copy.`}>Merge all {fmtNumber(needsMerge.length)}</SubmitButton>
          </form>
        </div>
      )}

      {tab === "unused" && editor && !MANDI_DELETE_ENABLED && (
        <p className="mb-4 rounded-lg bg-zinc-100 px-3 py-2 text-xs text-zinc-600">Removing duplicate records from the mandi list is turned off. An admin can turn it on with <code>ALLOW_MANDI_DELETE=true</code>.</p>
      )}
      {canRemove && removable > 0 && (
        <div className="card mb-4 border-red-200 p-4 text-sm">
          <div className="font-medium text-zinc-900">{fmtNumber(removable)} duplicate mandi record{removable === 1 ? "" : "s"} in the mandi list (available_mandi) {removable === 1 ? "has" : "have"} no mandi names linked</div>
          <p className="mt-1 text-xs text-zinc-600">Same district (or none) as the main copy, so they look like true duplicates. Removing deletes the record from the shared list (v1 loses it too). A copy of each is kept so it can be restored.</p>
          <form action={autoRemoveUnusedMandisAction} className="mt-3">
            <input type="hidden" name="back" value={back} />
            <input type="hidden" name="state" value={state} />
            <SubmitButton className="btn-danger" confirm={`Remove ${removable} duplicate mandi records from available_mandi? Copies are kept.`}>Remove all {fmtNumber(removable)}</SubmitButton>
          </form>
        </div>
      )}

      {page.length === 0 ? (
        <Empty title="No duplicates here">Nothing matches this tab and filter.</Empty>
      ) : (
        <div className="space-y-4">
          {page.map((g) => (
            <GroupCard key={`${g.stateCode}|${g.key}`} g={g} back={back} editor={editor} canRemove={canRemove} stateLabel={titleCase(names[g.stateCode] ?? g.stateCode.replace(/^\?/, ""))} />
          ))}
          {shown.length > page.length && <p className="text-xs text-zinc-500">Showing {page.length} of {fmtNumber(shown.length)}. Narrow with the state filter or search.</p>}
        </div>
      )}
    </>
  );
}

function GroupCard({ g, back, editor, canRemove, stateLabel }: { g: DupGroup; back: string; editor: boolean; canRemove: boolean; stateLabel: string }) {
  const main = g.members[0];
  const mandis: GraphMandi[] = g.members.map((m, i) => ({
    id: String(m._id), name: titleCase(m.name), district: m.district ? titleCase(m.district) : null, postcode: m.postcode,
    hasLocation: !!m.location, source: m.source, keep: i === 0,
  }));
  const names: GraphName[] = [
    ...g.members.flatMap((m) => m.links.map((l) => ({ id: String(l._id), raw: l.raw_name, source: l.source, status: l.status, listings: l.listings ?? 0, mandiId: String(m._id) }))),
    ...g.waiting.map((w) => ({ id: String(w._id), raw: w.raw_name, source: w.source, status: "pending", listings: w.listings ?? 0, mandiId: null })),
  ];
  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-zinc-100 px-4 py-3">
        <h2 className="font-semibold text-zinc-900">{titleCase(main.name)}</h2>
        <span className="text-xs text-zinc-500">{stateLabel} · {g.members.length} copies · {fmtNumber(sumListings(g))} listings</span>
        {g.linkedCopies > 1 && <Badge tone="amber" title="Names are linked to more than one copy">Prices split across {g.linkedCopies} copies</Badge>}
        {!g.safe && <Badge tone="red" title="The copies name different districts">Different districts</Badge>}
      </div>
      <div className="p-4">
        <div className="mb-2 grid grid-cols-[minmax(0,1fr)_72px_minmax(0,1fr)] text-[11px] font-medium tracking-wide text-zinc-400 uppercase sm:grid-cols-[minmax(0,1fr)_120px_minmax(0,1fr)]">
          <span>Mandi names (listings under each)</span>
          <span />
          <span>Mandis (the copies)</span>
        </div>
        <DupGraph mandis={mandis} names={names} editor={editor} canRemove={canRemove} back={back} />
      </div>
    </div>
  );
}

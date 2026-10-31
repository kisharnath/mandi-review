import clsx from "clsx";
import Link from "next/link";
import type { ObjectId } from "mongodb";
import { assignNameAction, createGroupAction, unassignNameAction } from "@/app/actions";
import { FilterSelect, Picker, SearchBox, SubmitButton, Tabs } from "@/components/client";
import { Badge, Empty, Flash, PageHeader, SectionTitle } from "@/components/ui";
import { canEdit, requireUser } from "@/lib/auth";
import { COLL, getDb, MAX_TIME_MS } from "@/lib/db";
import { escapeRegex, first, fmtDate, fmtNumber, normName, titleCase, toObjectId } from "@/lib/format";
import { listCropNames, type GroupDoc, type NameRow } from "@/lib/mapping";

export const maxDuration = 60;

const FLAG_BADGES: Record<string, { label: string; tone: "amber" | "violet" | "blue" | "gray" }> = {
  unmatched: { label: "Not matched", tone: "amber" },
  looks_wrong: { label: "Looks wrong", tone: "violet" },
  in_many_groups: { label: "In many groups", tone: "violet" },
  other_script: { label: "Local script", tone: "gray" },
};

export default async function MappingPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const user = await requireUser();
  const editor = canEdit(user);
  const db = await getDb();

  const view = first(sp.view) || "all";
  const q = normName(first(sp.q));
  const state = first(sp.state);
  const selected = normName(first(sp.name));

  const all = await listCropNames(db);
  const counts = {
    all: all.length,
    unmatched: all.filter((n) => n.flags.includes("unmatched")).length,
    looks_wrong: all.filter((n) => n.flags.includes("looks_wrong")).length,
    in_many_groups: all.filter((n) => n.flags.includes("in_many_groups")).length,
  };
  const states = [...new Set(all.flatMap((n) => n.states))].sort();
  const rows = all.filter(
    (n) =>
      (view === "all" || n.flags.includes(view as NameRow["flags"][number])) &&
      (!state || n.states.includes(state)) &&
      (!q || n.name.includes(q) || (n.groupName ?? "").includes(q)),
  );
  const current = selected ? all.find((n) => n.name === selected) ?? null : null;

  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) if (typeof v === "string" && v && k !== "msg" && k !== "err") qs.set(k, v);
  const back = `/mapping?${qs}`;
  const linkFor = (name: string) => {
    const next = new URLSearchParams(qs);
    next.set("name", name);
    return `/mapping?${next}`;
  };

  return (
    <>
      <PageHeader
        title="Crop matching"
        description="Every crop name the mandis use, and the crop group it belongs to. Pick a name to check it, then match it to the right crop group."
      />
      <Flash msg={first(sp.msg)} err={first(sp.err)} />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Tabs
          param="view"
          tabs={[
            { value: "all", label: "All names", count: counts.all },
            { value: "unmatched", label: "Not matched", count: counts.unmatched },
            { value: "looks_wrong", label: "Looks wrong", count: counts.looks_wrong },
            { value: "in_many_groups", label: "In many groups", count: counts.in_many_groups },
          ]}
        />
        <FilterSelect param="state" label="State" options={states.map((s) => ({ value: s, label: titleCase(s) }))} />
        <SearchBox placeholder="Search crop name or group…" />
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div className="card h-[calc(100vh-15rem)] overflow-y-auto">
          {rows.length === 0 ? (
            <div className="p-6 text-sm text-zinc-500">No names match.</div>
          ) : (
            <ul className="divide-y divide-zinc-100">
              {rows.map((n) => (
                <li key={n.name}>
                  <Link
                    href={linkFor(n.name)}
                    scroll={false}
                    className={clsx("block px-4 py-2.5 hover:bg-zinc-50", n.name === selected && "bg-emerald-50 hover:bg-emerald-50")}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="font-medium break-words text-zinc-900">{n.name}</span>
                      <span className="shrink-0 text-xs text-zinc-500 tabular-nums">{fmtNumber(n.listings)}</span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
                      {n.groupName ? <span className="text-zinc-600">→ {titleCase(n.groupName)}</span> : <span className="text-zinc-400">no group</span>}
                      {n.flags.filter((f) => f !== "unmatched" || !n.groupName).map((f) => (
                        <Badge key={f} tone={FLAG_BADGES[f].tone}>{FLAG_BADGES[f].label}</Badge>
                      ))}
                      {n.flags.includes("unmatched") && n.groupName && <Badge tone="amber">Partly matched</Badge>}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          {!current ? (
            <Empty title="Pick a crop name on the left">
              You will see where it is used, its latest prices, and options to match it to a crop group.
            </Empty>
          ) : (
            <NameDetail row={current} back={back} editor={editor} />
          )}
        </div>
      </div>
    </>
  );
}

async function NameDetail({ row, back, editor }: { row: NameRow; back: string; editor: boolean }) {
  const db = await getDb();
  const nameRx = { $regex: `^${escapeRegex(row.name)}$`, $options: "i" };
  const listings = await db
    .collection(COLL.markets)
    .find({ commodity_name: nameRx }, { projection: { state: 1, market_name: 1, source_system: 1, variety: 1, commodity_alias_lookup_id: 1 } })
    .limit(5000)
    .maxTimeMS(MAX_TIME_MS)
    .toArray();
  const ids = listings.map((l) => l._id as ObjectId);
  const [prices, holders, review] = await Promise.all([
    db.collection(COLL.prices).find({ market_commodity_id: { $in: ids }, date: { $lte: new Date() } }).sort({ date: -1 }).limit(8).maxTimeMS(MAX_TIME_MS).toArray(),
    db.collection<GroupDoc>(COLL.groups).find({ aliases: row.name }).toArray(),
    db.collection(COLL.review).findOne({ key: `unmapped_commodity|${row.name}` }),
  ]);
  const groupId = toObjectId(row.groupId);
  const group = groupId ? await db.collection<GroupDoc>(COLL.groups).findOne({ _id: groupId }) : null;
  const byListing = new Map(listings.map((l) => [String(l._id), l]));

  const byState = new Map<string, number>();
  for (const l of listings) byState.set(l.state ?? "unknown", (byState.get(l.state ?? "unknown") ?? 0) + 1);
  const suggestion = review?.suggestion as { group_id?: unknown; group_name?: string; reason?: string } | undefined;

  return (
    <div className="space-y-5">
      <div className="card p-5">
        <div className="text-xs font-medium tracking-wide text-zinc-500 uppercase">Crop name used by mandis</div>
        <h2 className="mt-1 text-xl font-semibold break-words text-zinc-900">{row.name}</h2>
        <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-sm text-zinc-600">
          <span><b className="text-zinc-900 tabular-nums">{fmtNumber(row.listings)}</b> mandi listings</span>
          <span><b className="text-zinc-900 tabular-nums">{row.states.length}</b> states</span>
          <span>Sources: {row.sources.join(", ") || "—"}</span>
        </div>
        <div className="mt-4 rounded-lg bg-zinc-50 p-3 text-sm">
          {row.groupName ? (
            <>
              Currently matched to{" "}
              {group ? <Link className="font-semibold text-emerald-800 hover:underline" href={`/groups/${String(group._id)}`}>{titleCase(row.groupName)}</Link> : <b>{row.groupName}</b>}
              {row.flags.includes("looks_wrong") && <span className="ml-2"><Badge tone="violet">Looks wrong — please check</Badge></span>}
              {row.flags.includes("unmatched") && <span className="ml-2"><Badge tone="amber">Some listings have no group</Badge></span>}
            </>
          ) : (
            <span className="font-medium text-amber-800">Not matched to any crop group. Farmers never see these prices.</span>
          )}
          {holders.length > 1 && (
            <div className="mt-2 text-violet-800">
              This name is listed in {holders.length} groups: {holders.map((h) => titleCase(h.canonical_name)).join(", ")}. Matching it below keeps only one.
            </div>
          )}
        </div>
        {group?.aliases?.length ? (
          <div className="mt-3 text-xs text-zinc-500">
            Other names in {titleCase(group.canonical_name)}: {group.aliases.filter((a) => a !== row.name).slice(0, 25).join(", ")}
            {group.aliases.length > 26 ? ` … +${group.aliases.length - 26}` : ""}
          </div>
        ) : null}
      </div>

      {editor && (
        <div className="card p-5">
          <SectionTitle>Match to a crop group</SectionTitle>
          {suggestion?.group_name && (
            <p className="mb-3 text-xs text-zinc-500">Computer guess: <b>{titleCase(suggestion.group_name)}</b> ({suggestion.reason}). Only accept it if it is right.</p>
          )}
          <form action={assignNameAction} className="flex flex-wrap items-start gap-2">
            <input type="hidden" name="back" value={back} />
            <input type="hidden" name="name" value={row.name} />
            <div className="min-w-64 flex-1">
              <Picker
                kind="groups"
                name="groupId"
                placeholder="Search crop groups…"
                initial={suggestion?.group_id ? { id: String(suggestion.group_id), label: titleCase(suggestion.group_name ?? "") } : null}
              />
            </div>
            <SubmitButton confirm={`Match "${row.name}" to the chosen crop group? This updates ${row.listings} listings and their prices.`}>Match</SubmitButton>
          </form>

          <details className="mt-4">
            <summary className="cursor-pointer text-sm font-medium text-emerald-700">The right crop group does not exist yet</summary>
            <form action={createGroupAction} className="mt-3 grid gap-3 sm:grid-cols-2">
              <input type="hidden" name="back" value={back} />
              <input type="hidden" name="name" value={row.name} />
              <div>
                <label className="label" htmlFor="canonical">New crop group name</label>
                <input id="canonical" name="canonical" className="input" placeholder="e.g. basmati paddy" required />
              </div>
              <div>
                <label className="label" htmlFor="notes">Note (optional)</label>
                <input id="notes" name="notes" className="input" placeholder="Why it is separate" />
              </div>
              <div className="sm:col-span-2">
                <SubmitButton>Create group and match “{row.name}” to it</SubmitButton>
              </div>
            </form>
          </details>

          {row.groupName && (
            <form action={unassignNameAction} className="mt-4 border-t border-zinc-100 pt-4">
              <input type="hidden" name="back" value={back} />
              <input type="hidden" name="name" value={row.name} />
              <SubmitButton className="btn-danger" confirm={`Remove the match for "${row.name}"? Its prices will be hidden from farmers until it is matched again.`}>
                Remove match (not a crop we show)
              </SubmitButton>
            </form>
          )}
        </div>
      )}

      <div className="grid gap-5 md:grid-cols-2">
        <div className="card p-5">
          <SectionTitle>Where it is used</SectionTitle>
          <ul className="space-y-1 text-sm">
            {[...byState.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([s, n]) => (
              <li key={s} className="flex justify-between"><span>{titleCase(s)}</span><span className="text-zinc-500 tabular-nums">{fmtNumber(n)}</span></li>
            ))}
          </ul>
          <Link className="mt-3 inline-block text-xs font-medium text-emerald-700 hover:underline" href={`/data/${COLL.markets}?q=${encodeURIComponent(row.name)}`}>
            See all listings →
          </Link>
        </div>
        <div className="card p-5">
          <SectionTitle>Latest prices</SectionTitle>
          {prices.length === 0 ? (
            <p className="text-sm text-zinc-500">No prices saved.</p>
          ) : (
            <ul className="space-y-1.5 text-sm">
              {prices.map((p) => {
                const l = byListing.get(String(p.market_commodity_id));
                return (
                  <li key={String(p._id)} className="flex justify-between gap-2">
                    <span className="truncate">
                      {titleCase(l?.market_name)} <span className="text-xs text-zinc-400">{fmtDate(p.date)}</span>
                    </span>
                    <span className="font-medium tabular-nums">₹{fmtNumber(p.modal_price)}</span>
                  </li>
                );
              })}
            </ul>
          )}
          <Link className="mt-3 inline-block text-xs font-medium text-emerald-700 hover:underline" href={`/data/${COLL.prices}?q=${encodeURIComponent(row.name)}`}>
            See all prices →
          </Link>
        </div>
      </div>
    </div>
  );
}

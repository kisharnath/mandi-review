import clsx from "clsx";
import Link from "next/link";
import type { Filter, ObjectId } from "mongodb";
import { decideMandiNameAction } from "@/app/actions";
import { FilterSelect, Picker, SearchBox, SubmitButton, Tabs } from "@/components/client";
import { Badge, Empty, Flash, PageHeader, SectionTitle } from "@/components/ui";
import { canEdit, requireUser } from "@/lib/auth";
import type { MandiNameDoc } from "@/lib/catalog";
import { COLL, getDb, MAX_TIME_MS } from "@/lib/db";
import { escapeRegex, first, fmtDate, fmtDateTime, fmtNumber, titleCase, toObjectId } from "@/lib/format";
import { MANDI_EDITS_ENABLED } from "@/lib/mandis";
import { stateNames } from "@/lib/stats";

export const maxDuration = 60;
const LIST_LIMIT = 400;

export default async function MandiLinksPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const user = await requireUser();
  const editor = canEdit(user);
  const db = await getDb();
  const status = first(sp.status) || "pending";
  const state = first(sp.state);
  const source = first(sp.source);
  const q = first(sp.q).trim();
  const selectedId = toObjectId(first(sp.id));

  const filter: Filter<MandiNameDoc> = {};
  if (status === "check") Object.assign(filter, { status: "approved", needs_check: true });
  else if (status !== "all") filter.status = status as MandiNameDoc["status"];
  if (state) filter.state_code = state;
  if (source) filter.source = source;
  if (q) filter.raw_name = { $regex: escapeRegex(q), $options: "i" };

  const coll = db.collection<MandiNameDoc>(COLL.mandiNames);
  const [docs, counts, checkCount, sources, names] = await Promise.all([
    coll.find(filter).sort({ listings: -1, raw_name: 1 }).limit(LIST_LIMIT).maxTimeMS(MAX_TIME_MS).toArray(),
    coll.aggregate<{ _id: string; n: number }>([{ $group: { _id: "$status", n: { $sum: 1 } } }]).toArray(),
    coll.countDocuments({ status: "approved", needs_check: true }),
    coll.distinct("source"),
    stateNames(),
  ]);
  const mandiIds = [...docs.map((d) => d.mandi_id), ...docs.map((d) => d.suggestion?.mandi_id)].filter(Boolean) as ObjectId[];
  const mandis = new Map(
    (await db.collection(COLL.mandis).find({ _id: { $in: mandiIds } }, { projection: { name: 1, district: 1 } }).toArray()).map((m) => [String(m._id), m]),
  );
  const countOf = (s: string) => counts.find((c) => c._id === s)?.n ?? 0;

  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) if (typeof v === "string" && v && k !== "msg" && k !== "err") qs.set(k, v);
  const back = `/mandi-links?${qs}`;
  const linkFor = (id: unknown) => {
    const next = new URLSearchParams(qs);
    next.set("id", String(id));
    return `/mandi-links?${next}`;
  };
  const selected = selectedId ? await coll.findOne({ _id: selectedId }) : null;

  return (
    <>
      <PageHeader
        title="Mandi names"
        description="Each mandi name a source uses in a state, and which mandi it is. A price only counts as “near the farmer” once its mandi name is approved."
      />
      <Flash msg={first(sp.msg)} err={first(sp.err)} />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Tabs
          param="status"
          tabs={[
            { value: "pending", label: "Pending", count: countOf("pending") },
            { value: "check", label: "Double-check", count: checkCount },
            { value: "approved", label: "Approved", count: countOf("approved") },
            { value: "rejected", label: "Rejected", count: countOf("rejected") },
            { value: "all", label: "All" },
          ]}
        />
        <FilterSelect param="state" label="State" options={Object.entries(names).sort((a, b) => a[1].localeCompare(b[1])).map(([code, n]) => ({ value: code, label: titleCase(n) }))} />
        <FilterSelect param="source" label="Source" options={sources.sort().map((s) => ({ value: s, label: s }))} />
        <SearchBox placeholder="Search mandi name…" />
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div className="card h-[calc(100vh-15rem)] overflow-y-auto">
          {docs.length === 0 ? (
            <div className="p-6 text-sm text-zinc-500">Nothing here.</div>
          ) : (
            <ul className="divide-y divide-zinc-100">
              {docs.map((d) => {
                const linked = d.mandi_id ? mandis.get(String(d.mandi_id)) : undefined;
                const guess = d.suggestion?.mandi_id ? mandis.get(String(d.suggestion.mandi_id)) : undefined;
                return (
                  <li key={String(d._id)}>
                    <Link href={linkFor(d._id)} scroll={false} className={clsx("block px-4 py-2.5 hover:bg-zinc-50", selectedId && String(d._id) === String(selectedId) && "bg-emerald-50 hover:bg-emerald-50")}>
                      <div className="flex items-start justify-between gap-2">
                        <span className="font-medium break-words text-zinc-900">{d.raw_name}</span>
                        <span className="shrink-0 text-xs text-zinc-500 tabular-nums">{fmtNumber(d.listings ?? 0)}</span>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
                        <span className="text-zinc-400">{titleCase(names[d.state_code ?? ""] ?? d.state_code ?? "no state")} · {d.source}</span>
                        {d.status === "approved" && d.needs_check ? <Badge tone="blue">Approved by migration</Badge> : (
                          <Badge tone={d.status === "approved" ? "green" : d.status === "rejected" ? "red" : "amber"}>{titleCase(d.status)}</Badge>
                        )}
                        {linked && <span className="text-zinc-700">→ {titleCase(String(linked.name))}</span>}
                        {!linked && guess && <span className="text-zinc-500">guess: {titleCase(String(guess.name))}</span>}
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div>
          {!selected ? (
            <Empty title="Pick a mandi name on the left">You will see which crops it lists and can link it to the right mandi.</Empty>
          ) : (
            <Detail row={selected} back={back} editor={editor} stateLabel={titleCase(names[selected.state_code ?? ""] ?? selected.state_code ?? "")} />
          )}
        </div>
      </div>
    </>
  );
}

async function Detail({ row, back, editor, stateLabel }: { row: MandiNameDoc; back: string; editor: boolean; stateLabel: string }) {
  const db = await getDb();
  const [listings, linked, guess] = await Promise.all([
    db.collection(COLL.listings)
      .find({ source_system: row.source, state_code: row.state_code ?? null, market_name: { $regex: `^${escapeRegex(row.raw_name)}$`, $options: "i" } }, { projection: { commodity_name: 1 } })
      .limit(500).toArray(),
    row.mandi_id ? db.collection(COLL.mandis).findOne({ _id: row.mandi_id }) : null,
    row.suggestion?.mandi_id ? db.collection(COLL.mandis).findOne({ _id: row.suggestion.mandi_id }) : null,
  ]);
  const latest = listings.length
    ? await db.collection(COLL.prices).find({ market_commodity_id: { $in: listings.map((l) => l._id) } }, { projection: { date: 1 } }).sort({ date: -1 }).limit(1).next()
    : null;
  const initial = linked ? { id: String(linked._id), label: titleCase(String(linked.name)) } : guess ? { id: String(guess._id), label: titleCase(String(guess.name)) } : null;
  const newMandi = new URLSearchParams({ name: row.raw_name, state: stateLabel.toLowerCase(), linkId: String(row._id) });

  return (
    <div className="space-y-5">
      <div className="card p-5">
        <div className="text-xs font-medium tracking-wide text-zinc-500 uppercase">Mandi name from {row.source} · {stateLabel || "no state"}</div>
        <h2 className="mt-1 text-xl font-semibold break-words text-zinc-900">{row.raw_name}</h2>
        <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-sm text-zinc-600">
          <span><b className="text-zinc-900 tabular-nums">{fmtNumber(listings.length)}</b> crop listings</span>
          <span>Last price {latest ? fmtDate(latest.date) : "—"}</span>
        </div>
        <div className="mt-4 rounded-lg bg-zinc-50 p-3 text-sm">
          {linked ? (
            <span>Linked to <Link className="font-semibold text-emerald-800 hover:underline" href={`/mandis/${String(linked._id)}`}>{titleCase(String(linked.name))}</Link> ({titleCase(String(linked.district ?? ""))})</span>
          ) : (
            <span className="text-amber-800">Not linked to a mandi.</span>
          )}
          {row.decided_by && <div className="mt-1 text-xs text-zinc-500">Decided by {row.decided_by} · {fmtDateTime(row.decided_at)}{row.needs_check && " · nobody has checked this yet"}</div>}
          {row.suggestion?.reason && (
            <div className="mt-2 text-xs text-zinc-600">Old system: {guess ? <b>{titleCase(String(guess.name))}</b> : "no mandi"} — {row.suggestion.reason}</div>
          )}
        </div>
        <div className="mt-3 text-xs text-zinc-500">Crops listed: {[...new Set(listings.map((l) => l.commodity_name))].slice(0, 20).join(", ")}</div>
      </div>

      {editor && (
        <div className="card p-5">
          <SectionTitle>Decide</SectionTitle>
          <form action={decideMandiNameAction} className="space-y-3">
            <input type="hidden" name="back" value={back} />
            <input type="hidden" name="id" value={String(row._id)} />
            <div>
              <label className="label">It is this mandi</label>
              <Picker kind="mandis" name="mandiId" state={row.state_code ?? undefined} placeholder="Search mandis in this state…" initial={initial} />
            </div>
            <input name="notes" className="input" placeholder="Note (optional)" defaultValue={row.notes ?? ""} />
            <div className="flex flex-wrap gap-2">
              <SubmitButton name="status" value="approved">{row.status === "approved" ? "Save" : "Approve"}</SubmitButton>
              {row.status !== "rejected" && <SubmitButton className="btn-danger" name="status" value="rejected">Reject</SubmitButton>}
              {row.status !== "pending" && <SubmitButton className="btn-secondary" name="status" value="pending">Back to pending</SubmitButton>}
            </div>
          </form>
          {MANDI_EDITS_ENABLED ? (
            <Link className="mt-4 inline-block text-xs font-medium text-emerald-700 hover:underline" href={`/mandis/new?${newMandi}`}>
              It is a new mandi: add it →
            </Link>
          ) : (
            <p className="mt-4 text-xs text-zinc-500">The mandi list is shared with the v1 system, so new mandis are added there, not here.</p>
          )}
        </div>
      )}
    </div>
  );
}

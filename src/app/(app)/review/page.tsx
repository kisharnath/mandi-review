import Link from "next/link";
import type { Filter } from "mongodb";
import { linkMandiAction, scanAction, setReviewStatusAction } from "@/app/actions";
import { FilterSelect, Picker, SearchBox, SelectAll, SubmitButton, Tabs } from "@/components/client";
import { Pagination } from "@/components/pagination";
import { Badge, Empty, Flash, PageHeader, TYPE_LABELS, TypeBadge } from "@/components/ui";
import { canEdit, requireUser } from "@/lib/auth";
import { COLL, getDb, MAX_TIME_MS } from "@/lib/db";
import { escapeRegex, first, fmtDateTime, fmtNumber, titleCase } from "@/lib/format";

export const maxDuration = 60;
const PAGE = 50;

type Item = {
  _id: unknown;
  key: string;
  type: string;
  status: string;
  title: string;
  state?: string | null;
  source?: string | null;
  states?: string[];
  sources?: string[];
  sample_markets?: string[];
  sample_commodities?: string[];
  records_seen?: number;
  first_seen?: Date;
  last_seen?: Date;
  details?: Record<string, unknown>;
  suggestion?: { group_id?: unknown; group_name?: string; score?: number; reason?: string; by?: string };
  resolved_by?: string;
  resolved_at?: Date;
  resolution?: Record<string, unknown>;
};

export default async function ReviewPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const user = await requireUser();
  const editor = canEdit(user);
  const status = first(sp.status) || "open";
  const type = first(sp.type);
  const state = first(sp.state);
  const q = first(sp.q);
  const page = Math.max(1, Number(first(sp.page)) || 1);

  const db = await getDb();
  const coll = db.collection<Item>(COLL.review);
  const filter: Filter<Item> = { status };
  if (type) filter.type = type;
  if (state) filter.$or = [{ state }, { states: state }];
  if (q) filter.title = { $regex: escapeRegex(q), $options: "i" };

  const [items, total, statusCounts, states] = await Promise.all([
    coll.find(filter).sort({ records_seen: -1, last_seen: -1 }).skip((page - 1) * PAGE).limit(PAGE).maxTimeMS(MAX_TIME_MS).toArray(),
    coll.countDocuments(filter, { maxTimeMS: MAX_TIME_MS }),
    coll.aggregate<{ _id: string; n: number }>([{ $match: type ? { type } : {} }, { $group: { _id: "$status", n: { $sum: 1 } } }]).toArray(),
    coll.distinct("state").catch(() => [] as string[]),
  ]);
  const countOf = (s: string) => statusCounts.find((c) => c._id === s)?.n ?? 0;

  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) if (typeof v === "string" && v && k !== "msg" && k !== "err") qs.set(k, v);
  const back = `/review${qs.size ? `?${qs}` : ""}`;

  return (
    <>
      <PageHeader
        title="Review list"
        description="Problems found in scraped data. Fix the cause (match a crop name, link a mandi), or mark an item as checked."
        actions={
          editor && (
            <form action={scanAction}>
              <input type="hidden" name="back" value={back} />
              <SubmitButton className="btn-secondary" confirm="Check all crop names in the database for problems? This adds items to the list but changes nothing else.">
                Scan current data
              </SubmitButton>
            </form>
          )
        }
      />
      <Flash msg={first(sp.msg)} err={first(sp.err)} />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Tabs
          param="status"
          tabs={[
            { value: "open", label: "Open", count: countOf("open") },
            { value: "resolved", label: "Fixed", count: countOf("resolved") },
            { value: "ignored", label: "Ignored", count: countOf("ignored") },
          ]}
        />
        <FilterSelect param="type" label="Type" options={Object.entries(TYPE_LABELS).map(([value, t]) => ({ value, label: t.label }))} />
        <FilterSelect param="state" label="State" options={states.filter(Boolean).map(String).sort().map((s) => ({ value: s, label: titleCase(s) }))} />
        <SearchBox placeholder="Search problems…" />
      </div>

      {items.length === 0 ? (
        <Empty title={status === "open" ? "Nothing waiting here" : "No items"}>
          {status === "open" && "New problems appear after each scrape run, or when you press “Scan current data”."}
        </Empty>
      ) : (
        <>
          {editor && (
            <form id="bulk" action={setReviewStatusAction} className="card mb-3 flex flex-wrap items-center gap-3 px-4 py-2.5">
              <input type="hidden" name="back" value={back} />
              <span className="text-sm text-zinc-600">With ticked items:</span>
              <input name="note" className="input max-w-xs py-1" placeholder="Note (optional)" />
              {status !== "resolved" && <SubmitButton className="btn-secondary" name="status" value="resolved">Mark fixed</SubmitButton>}
              {status !== "ignored" && <SubmitButton className="btn-secondary" name="status" value="ignored">Ignore</SubmitButton>}
              {status !== "open" && <SubmitButton className="btn-secondary" name="status" value="open">Reopen</SubmitButton>}
            </form>
          )}

          <div className="card overflow-hidden">
            <table className="table-base">
              <thead>
                <tr>
                  {editor && <th className="w-8"><SelectAll name="ids" /></th>}
                  <th>Problem</th>
                  <th>Where</th>
                  <th className="text-right">Records</th>
                  <th>Seen</th>
                  <th className="w-[26rem]">Fix</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it) => (
                  <tr key={String(it._id)}>
                    {editor && (
                      <td><input type="checkbox" name="ids" value={String(it._id)} form="bulk" className="h-4 w-4 accent-emerald-700" aria-label={`Select ${it.title}`} /></td>
                    )}
                    <td>
                      <div className="mb-1"><TypeBadge type={it.type} /></div>
                      <div className="font-medium text-zinc-900">{it.title}</div>
                      <Details item={it} />
                      {it.status !== "open" && (
                        <div className="mt-1 text-xs text-zinc-500">
                          {it.status === "resolved" ? "Fixed" : "Ignored"} by {it.resolved_by ?? "?"} · {fmtDateTime(it.resolved_at)}
                          {typeof it.resolution?.note === "string" && it.resolution.note ? ` · “${it.resolution.note}”` : ""}
                        </div>
                      )}
                    </td>
                    <td className="text-xs text-zinc-600">
                      {it.state && <div>{titleCase(it.state)}</div>}
                      {!it.state && it.states?.length ? <div>{it.states.slice(0, 4).map(titleCase).join(", ")}{it.states.length > 4 ? ` +${it.states.length - 4}` : ""}</div> : null}
                      <div className="text-zinc-400">{it.source ?? it.sources?.join(", ")}</div>
                    </td>
                    <td className="text-right tabular-nums">{fmtNumber(it.records_seen)}</td>
                    <td className="text-xs whitespace-nowrap text-zinc-500">
                      <div>{fmtDateTime(it.last_seen)}</div>
                      {it.first_seen && <div className="text-zinc-400">first {fmtDateTime(it.first_seen)}</div>}
                    </td>
                    <td><FixCell item={it} back={back} editor={editor && it.status === "open"} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={page} pageSize={PAGE} total={total} />
        </>
      )}
    </>
  );
}

function Details({ item }: { item: Item }) {
  const d = item.details ?? {};
  if (item.type === "price_invalid") {
    return (
      <div className="mt-1 text-xs text-zinc-600">
        {(d.problems as string[] | undefined)?.join("; ")} · min {String(d.min_price ?? "—")}, max {String(d.max_price ?? "—")}, modal {String(d.modal_price ?? "—")}
      </div>
    );
  }
  if (item.type === "run_failed") return <div className="mt-1 text-xs break-words text-red-700">{String(d.error ?? "")}</div>;
  if (item.type === "duplicate_alias") {
    const groups = (d.groups as { name: string }[] | undefined) ?? [];
    return <div className="mt-1 text-xs text-zinc-600">In: {groups.map((g) => titleCase(g.name)).join(", ")}</div>;
  }
  const samples = item.sample_markets ?? item.sample_commodities;
  return (
    <>
      {samples?.length ? <div className="mt-1 text-xs text-zinc-500">e.g. {samples.slice(0, 4).map(titleCase).join(", ")}</div> : null}
      {item.suggestion?.group_name && (
        <div className="mt-1 text-xs text-zinc-600">
          Computer guess: <Badge tone="gray">{titleCase(item.suggestion.group_name)}</Badge>{" "}
          <span className="text-zinc-400">{item.suggestion.reason}</span>
        </div>
      )}
    </>
  );
}

function FixCell({ item, back, editor }: { item: Item; back: string; editor: boolean }) {
  const d = item.details ?? {};
  const name = String(d.commodity_name ?? "");
  if (["unmapped_commodity", "suspicious_mapping", "duplicate_alias"].includes(item.type)) {
    return (
      <Link className="btn-secondary" href={`/mapping?name=${encodeURIComponent(name)}`}>
        Open in crop matching →
      </Link>
    );
  }
  if (item.type === "unknown_market") {
    const market = String(d.market_name ?? "");
    if (!editor) return null;
    return (
      <div className="space-y-2">
        <form action={linkMandiAction} className="flex items-start gap-2">
          <input type="hidden" name="back" value={back} />
          <input type="hidden" name="name" value={market} />
          <input type="hidden" name="state" value={item.state ?? ""} />
          <div className="flex-1"><Picker kind="mandis" name="mandiId" state={item.state ?? undefined} placeholder="It is the same as…" /></div>
          <SubmitButton>Link</SubmitButton>
        </form>
        <Link className="text-xs font-medium text-emerald-700 hover:underline" href={`/mandis/new?name=${encodeURIComponent(market)}&state=${encodeURIComponent(item.state ?? "")}`}>
          Or add it as a new mandi →
        </Link>
      </div>
    );
  }
  if (item.type === "price_invalid") {
    return (
      <Link className="btn-secondary" href={`/data/${COLL.prices}?q=${encodeURIComponent(String(d.market_name ?? ""))}&date=${String(d.date ?? "")}`}>
        See prices →
      </Link>
    );
  }
  if (item.type === "run_failed") {
    return <Link className="btn-secondary" href="/runs?status=failed">See runs →</Link>;
  }
  return null;
}

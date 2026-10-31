import Link from "next/link";
import type { Filter } from "mongodb";
import { addStateSpellingAction, setReviewStatusAction } from "@/app/actions";
import { FilterSelect, SearchBox, SelectAll, SubmitButton, Tabs } from "@/components/client";
import { Pagination } from "@/components/pagination";
import { Empty, Flash, PageHeader, StatCard, TYPE_LABELS, TypeBadge } from "@/components/ui";
import { canEdit, requireUser } from "@/lib/auth";
import { linkCounts } from "@/lib/catalog";
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
  records_seen?: number;
  first_seen?: Date;
  last_seen?: Date;
  details?: Record<string, unknown>;
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
  const q = first(sp.q);
  const page = Math.max(1, Number(first(sp.page)) || 1);

  const db = await getDb();
  const coll = db.collection<Item>(COLL.review);
  const filter: Filter<Item> = { status };
  if (type) filter.type = type;
  if (q) filter.title = { $regex: escapeRegex(q), $options: "i" };

  const [items, total, statusCounts, links, states] = await Promise.all([
    coll.find(filter).sort({ last_seen: -1 }).skip((page - 1) * PAGE).limit(PAGE).maxTimeMS(MAX_TIME_MS).toArray(),
    coll.countDocuments(filter, { maxTimeMS: MAX_TIME_MS }),
    coll.aggregate<{ _id: string; n: number }>([{ $match: type ? { type } : {} }, { $group: { _id: "$status", n: { $sum: 1 } } }]).toArray(),
    linkCounts(db),
    db.collection<{ _id: string; name: string }>(COLL.states).find({}, { projection: { name: 1 } }).sort({ name: 1 }).toArray(),
  ]);
  const countOf = (s: string) => statusCounts.find((c) => c._id === s)?.n ?? 0;

  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) if (typeof v === "string" && v && k !== "msg" && k !== "err") qs.set(k, v);
  const back = `/review${qs.size ? `?${qs}` : ""}`;

  return (
    <>
      <PageHeader title="Review list" description="Everything waiting for a person. Name links are reviewed on their own pages; other problems are listed below." />
      <Flash msg={first(sp.msg)} err={first(sp.err)} />

      <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Crop names pending" value={fmtNumber(links.cropPending)} hint="no price shown until approved" href="/mapping" tone={links.cropPending ? "warn" : undefined} />
        <StatCard label="Crop names to double-check" value={fmtNumber(links.cropCheck)} hint="approved by the migration, not by a person" href="/mapping?status=check" />
        <StatCard label="Mandi names pending" value={fmtNumber(links.mandiPending)} hint="prices not tied to a mandi" href="/mandi-links" tone={links.mandiPending ? "warn" : undefined} />
        <StatCard label="Mandi names to double-check" value={fmtNumber(links.mandiCheck)} hint="approved by the migration, not by a person" href="/mandi-links?status=check" />
      </div>

      <h2 className="mb-3 text-sm font-semibold text-zinc-800">Other problems</h2>
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
        <SearchBox placeholder="Search problems…" />
      </div>

      {items.length === 0 ? (
        <Empty title={status === "open" ? "Nothing waiting here" : "No items"}>
          {status === "open" && "Failed scrapes, odd prices and unknown state spellings appear here after each scrape run."}
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
                  <th className="w-[24rem]">Fix</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it) => {
                  const d = it.details ?? {};
                  return (
                    <tr key={String(it._id)}>
                      {editor && (
                        <td><input type="checkbox" name="ids" value={String(it._id)} form="bulk" className="h-4 w-4 accent-emerald-700" aria-label={`Select ${it.title}`} /></td>
                      )}
                      <td>
                        <div className="mb-1"><TypeBadge type={it.type} /></div>
                        <div className="font-medium text-zinc-900">{it.title}</div>
                        {it.type === "price_invalid" && (
                          <div className="mt-1 text-xs text-zinc-600">
                            {(d.problems as string[] | undefined)?.join("; ")} · min {String(d.min_price ?? "—")}, max {String(d.max_price ?? "—")}, modal {String(d.modal_price ?? "—")}
                          </div>
                        )}
                        {it.type === "run_failed" && <div className="mt-1 text-xs break-words text-red-700">{String(d.error ?? "")}</div>}
                        {it.status !== "open" && (
                          <div className="mt-1 text-xs text-zinc-500">
                            {it.status === "resolved" ? "Fixed" : "Ignored"} by {it.resolved_by ?? "?"} · {fmtDateTime(it.resolved_at)}
                          </div>
                        )}
                      </td>
                      <td className="text-xs text-zinc-600">
                        {it.state && <div>{titleCase(it.state)}</div>}
                        <div className="text-zinc-400">{it.source}</div>
                      </td>
                      <td className="text-right tabular-nums">{fmtNumber(it.records_seen)}</td>
                      <td className="text-xs whitespace-nowrap text-zinc-500">{fmtDateTime(it.last_seen)}</td>
                      <td>
                        {it.type === "unknown_state" && editor && it.status === "open" ? (
                          <form action={addStateSpellingAction} className="flex items-center gap-2">
                            <input type="hidden" name="back" value={back} />
                            <input type="hidden" name="spelling" value={String(d.spelling ?? "")} />
                            <select name="code" className="input py-1" required defaultValue="">
                              <option value="" disabled>It is a spelling of…</option>
                              {states.map((s) => <option key={s._id} value={s._id}>{titleCase(s.name)}</option>)}
                            </select>
                            <SubmitButton>Add</SubmitButton>
                          </form>
                        ) : it.type === "price_invalid" ? (
                          <Link className="btn-secondary" href={`/data/${COLL.prices}?q=${encodeURIComponent(String(d.market_name ?? ""))}&date=${String(d.date ?? "")}`}>See prices →</Link>
                        ) : it.type === "run_failed" ? (
                          <Link className="btn-secondary" href="/runs?status=failed">See runs →</Link>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Pagination page={page} pageSize={PAGE} total={total} />
        </>
      )}
    </>
  );
}

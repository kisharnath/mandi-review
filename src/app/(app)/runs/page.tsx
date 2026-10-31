import { FilterSelect } from "@/components/client";
import { Badge, Empty, PageHeader } from "@/components/ui";
import { COLL, getDb, MAX_TIME_MS } from "@/lib/db";
import { first, fmtDateTime, fmtNumber, titleCase } from "@/lib/format";

type StateRow = { state: string; records: number; markets: number; unmapped_commodities: number; unknown_markets: number };
type RunDoc = {
  run_id: string;
  source: string;
  success: boolean;
  error?: string | null;
  records_fetched?: number;
  records_normalised?: number;
  started_at: Date;
  elapsed_seconds?: number;
  states?: StateRow[];
  upload_stats?: Record<string, number | string>;
  unmapped_commodities?: number;
  unknown_markets?: number;
  price_problems?: number;
};

export default async function RunsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const source = first(sp.source);
  const failedOnly = first(sp.status) === "failed";
  const db = await getDb();
  const runs = db.collection<RunDoc>(COLL.runs);

  // Pick the latest 30 runs that match, then load every source of those runs.
  const match: Record<string, unknown> = {};
  if (source) match.source = source;
  if (failedOnly) match.success = false;
  const runIds = (
    await runs
      .aggregate<{ _id: string }>([{ $match: match }, { $group: { _id: "$run_id", at: { $max: "$started_at" } } }, { $sort: { at: -1 } }, { $limit: 30 }], { maxTimeMS: MAX_TIME_MS })
      .toArray()
  ).map((r) => r._id);
  const [docs, sources] = await Promise.all([
    runs.find({ run_id: { $in: runIds } }).sort({ started_at: -1, source: 1 }).toArray(),
    runs.distinct("source").catch(() => [] as string[]),
  ]);
  const grouped = runIds.map((id) => docs.filter((d) => d.run_id === id));

  return (
    <>
      <PageHeader title="Scrape runs" description="Each run of the scraper, with what every source fetched and saved, and why a source failed." />
      <div className="mb-4 flex flex-wrap items-center gap-4">
        <FilterSelect param="source" label="Source" options={sources.filter((s) => s !== "_pipeline").map((s) => ({ value: s, label: s }))} />
        <FilterSelect param="status" label="Show" allLabel="All runs" options={[{ value: "failed", label: "Only runs with failures" }]} />
      </div>

      {grouped.length === 0 ? (
        <Empty title="No runs recorded yet">Runs appear here after the updated scraper (branch fix/review-pipeline) has run once.</Empty>
      ) : (
        <div className="space-y-4">
          {grouped.map((run) => {
            const pipeline = run.find((r) => r.source === "_pipeline");
            const parts = run.filter((r) => r.source !== "_pipeline");
            const failed = parts.filter((p) => !p.success);
            return (
              <details key={run[0].run_id} className="card group overflow-hidden" open={grouped[0] === run}>
                <summary className="flex cursor-pointer list-none flex-wrap items-center gap-3 px-4 py-3 text-sm hover:bg-zinc-50">
                  <Badge tone={failed.length ? "red" : "green"}>{failed.length ? `${failed.length} failed` : "All worked"}</Badge>
                  <span className="font-medium text-zinc-900">{fmtDateTime(run[0].started_at)}</span>
                  <span className="text-zinc-500">{parts.length} sources</span>
                  <span className="text-zinc-500">{fmtNumber(pipeline?.records_normalised ?? parts.reduce((a, p) => a + (p.records_normalised ?? 0), 0))} prices saved</span>
                  {pipeline?.elapsed_seconds !== undefined && <span className="text-zinc-500">{Math.round(pipeline.elapsed_seconds / 60)} min</span>}
                  {pipeline && (
                    <span className="ml-auto flex gap-2">
                      {!!pipeline.unmapped_commodities && <Badge tone="amber">{pipeline.unmapped_commodities} unmatched crops</Badge>}
                      {!!pipeline.unknown_markets && <Badge tone="blue">{pipeline.unknown_markets} unknown mandis</Badge>}
                      {!!pipeline.price_problems && <Badge tone="red">{pipeline.price_problems} odd prices</Badge>}
                    </span>
                  )}
                </summary>
                <div className="border-t border-zinc-100">
                  {pipeline?.error && <div className="bg-red-50 px-4 py-2 text-sm text-red-800">Saving to the database failed: {pipeline.error}</div>}
                  <table className="table-base">
                    <thead>
                      <tr><th>Source</th><th>Status</th><th className="text-right">Fetched</th><th className="text-right">Saved</th><th>States</th><th>Error</th></tr>
                    </thead>
                    <tbody>
                      {parts.map((p) => (
                        <tr key={p.source}>
                          <td className="font-medium">{p.source}</td>
                          <td><Badge tone={p.success ? "green" : "red"}>{p.success ? "Worked" : "Failed"}</Badge></td>
                          <td className="text-right tabular-nums">{fmtNumber(p.records_fetched)}</td>
                          <td className="text-right tabular-nums">{fmtNumber(p.records_normalised)}</td>
                          <td className="text-xs text-zinc-600">
                            {(p.states ?? []).length === 0 ? (
                              "—"
                            ) : (
                              <details>
                                <summary className="cursor-pointer text-emerald-700">{p.states!.length} states</summary>
                                <ul className="mt-1 space-y-0.5">
                                  {p.states!.map((s) => (
                                    <li key={s.state}>
                                      {titleCase(s.state)}: {fmtNumber(s.records)} prices, {fmtNumber(s.markets)} mandis
                                      {s.unmapped_commodities ? `, ${s.unmapped_commodities} unmatched crops` : ""}
                                      {s.unknown_markets ? `, ${s.unknown_markets} unknown mandis` : ""}
                                    </li>
                                  ))}
                                </ul>
                              </details>
                            )}
                          </td>
                          <td className="max-w-sm text-xs break-words text-red-700">{p.error}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {pipeline?.upload_stats && Object.keys(pipeline.upload_stats).length > 0 && (
                    <div className="border-t border-zinc-100 px-4 py-2 text-xs text-zinc-500">
                      Database save: {Object.entries(pipeline.upload_stats).map(([k, v]) => `${k.replace(/_/g, " ")} ${v}`).join(" · ")}
                    </div>
                  )}
                </div>
              </details>
            );
          })}
        </div>
      )}
    </>
  );
}

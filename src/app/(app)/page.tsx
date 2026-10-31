import Link from "next/link";
import { DateFilter } from "@/components/client";
import { Badge, Empty, PageHeader, SectionTitle, StatCard, TYPE_LABELS } from "@/components/ui";
import { linkCounts } from "@/lib/catalog";
import { getDb } from "@/lib/db";
import { first, fmtDate, fmtDateTime, fmtNumber, titleCase } from "@/lib/format";
import { latestPriceDay, latestRuns, openReviewCounts, stateCoverage, stateNames } from "@/lib/stats";

export const maxDuration = 60;

type RunDoc = {
  run_id: string;
  source: string;
  success: boolean;
  error?: string | null;
  records_fetched?: number;
  records_normalised?: number;
  started_at: Date;
  elapsed_seconds?: number;
};

export default async function TodayPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const latest = await latestPriceDay();
  const day = first(sp.day) || latest;

  const [coverage, runs, open, links, names] = await Promise.all([
    stateCoverage(day), latestRuns(60), openReviewCounts(), linkCounts(await getDb()), stateNames(),
  ]);
  const runDocs = runs as unknown as RunDoc[];
  const lastRunId = runDocs[0]?.run_id;
  const lastRun = runDocs.filter((r) => r.run_id === lastRunId);
  const pipeline = lastRun.find((r) => r.source === "_pipeline");
  const sources = lastRun.filter((r) => r.source !== "_pipeline");

  const totals = coverage.reduce(
    (t, s) => ({
      records: t.records + s.records, visible: t.visible + s.withProduct, mandis: t.mandis + s.mandis,
      silent: t.silent + s.silent, states: t.states + (s.records > 0 ? 1 : 0),
    }),
    { records: 0, visible: 0, mandis: 0, silent: 0, states: 0 },
  );
  const visiblePct = totals.records ? Math.round((totals.visible / totals.records) * 100) : 0;
  const openTotal = Object.values(open).reduce((a, b) => a + b, 0);

  return (
    <>
      <PageHeader
        title={`Prices for ${fmtDate(day)}`}
        description={day === latest ? "Latest day with saved prices. Pick another day to compare." : `Latest day with saved prices is ${fmtDate(latest)}.`}
        actions={<DateFilter param="day" label="Day" />}
      />

      <div className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-5">
        <StatCard label="Prices saved" value={fmtNumber(totals.records)} hint={`${fmtNumber(totals.states)} states, ${fmtNumber(totals.mandis)} mandis`} />
        <StatCard
          label="Farmers can see"
          value={`${visiblePct}%`}
          hint={`${fmtNumber(totals.records - totals.visible)} prices wait for an approved product`}
          tone={visiblePct < 90 ? "warn" : undefined}
          href="/mapping"
        />
        <StatCard label="Crop names to review" value={fmtNumber(links.cropPending)} hint={`${fmtNumber(links.cropCheck)} approved by migration, unchecked`} href="/mapping" tone={links.cropPending ? "warn" : undefined} />
        <StatCard label="Mandi names to review" value={fmtNumber(links.mandiPending)} hint={`${fmtNumber(links.mandiCheck)} approved by migration, unchecked`} href="/mandi-links" tone={links.mandiPending ? "warn" : undefined} />
        <StatCard label="Other problems" value={fmtNumber(openTotal)} hint="failed runs, odd prices, state spellings" href="/review" tone={openTotal ? "warn" : undefined} />
      </div>

      <div className="mb-8 grid gap-6 lg:grid-cols-3">
        <section className="lg:col-span-2">
          <SectionTitle aside={<Link href="/runs" className="text-xs font-medium text-emerald-700 hover:underline">All runs →</Link>}>
            Last scrape run
          </SectionTitle>
          {!lastRunId ? (
            <Empty title="No scrape runs recorded yet">Runs appear after the v2 scraper (branch feat/catalog-v2) has run once against this database.</Empty>
          ) : (
            <div className="card overflow-hidden">
              <div className="flex flex-wrap items-center gap-3 border-b border-zinc-100 px-4 py-3 text-sm">
                <Badge tone={pipeline?.success ? "green" : "red"}>{pipeline?.success ? "All sources worked" : "Some sources failed"}</Badge>
                <span className="text-zinc-600">Started {fmtDateTime(lastRun[0]?.started_at)}</span>
                {pipeline?.elapsed_seconds !== undefined && <span className="text-zinc-500">took {Math.round(pipeline.elapsed_seconds / 60)} min</span>}
              </div>
              <table className="table-base">
                <thead>
                  <tr><th>Source</th><th>Status</th><th className="text-right">Fetched</th><th className="text-right">Saved</th><th>Error</th></tr>
                </thead>
                <tbody>
                  {sources.map((s) => (
                    <tr key={s.source}>
                      <td className="font-medium">{s.source}</td>
                      <td><Badge tone={s.success ? "green" : "red"}>{s.success ? "Worked" : "Failed"}</Badge></td>
                      <td className="text-right tabular-nums">{fmtNumber(s.records_fetched)}</td>
                      <td className="text-right tabular-nums">{fmtNumber(s.records_normalised)}</td>
                      <td className="max-w-xs truncate text-xs text-red-700" title={s.error ?? ""}>{s.error}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section>
          <SectionTitle aside={<Link href="/review" className="text-xs font-medium text-emerald-700 hover:underline">Open list →</Link>}>
            Other problems
          </SectionTitle>
          <div className="card divide-y divide-zinc-100">
            {Object.keys(TYPE_LABELS).map((type) => (
              <Link key={type} href={`/review?type=${type}`} className="flex items-center justify-between px-4 py-2.5 text-sm hover:bg-zinc-50">
                <span className="text-zinc-700">{TYPE_LABELS[type].label}</span>
                <span className={open[type] ? "font-semibold text-amber-700 tabular-nums" : "text-zinc-400 tabular-nums"}>{fmtNumber(open[type] ?? 0)}</span>
              </Link>
            ))}
          </div>
        </section>
      </div>

      <section>
        <SectionTitle>By state</SectionTitle>
        {coverage.length === 0 ? (
          <Empty title="No prices on this day" />
        ) : (
          <div className="card overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th>State</th>
                  <th className="text-right">Prices</th>
                  <th className="text-right">Farmers can see</th>
                  <th className="text-right">Mandis today</th>
                  <th className="text-right">Usual mandis</th>
                  <th className="w-1/5">Coverage</th>
                  <th className="text-right">Missing today</th>
                </tr>
              </thead>
              <tbody>
                {coverage.map((s) => {
                  const pct = s.usualMandis ? Math.min(100, Math.round((s.mandis / s.usualMandis) * 100)) : s.mandis ? 100 : 0;
                  const vis = s.records ? Math.round((s.withProduct / s.records) * 100) : 0;
                  return (
                    <tr key={s.state}>
                      <td className="font-medium">{titleCase(names[s.state] ?? s.state)}</td>
                      <td className="text-right tabular-nums">{fmtNumber(s.records)}</td>
                      <td className={`text-right tabular-nums ${vis < 90 ? "text-amber-700" : "text-zinc-600"}`}>{s.records ? `${vis}%` : "—"}</td>
                      <td className="text-right tabular-nums">{fmtNumber(s.mandis)}</td>
                      <td className="text-right text-zinc-500 tabular-nums">{fmtNumber(s.usualMandis)}</td>
                      <td>
                        <div className="flex items-center gap-2">
                          <div className="h-2 flex-1 overflow-hidden rounded-full bg-zinc-100">
                            <div className={pct >= 80 ? "h-full bg-emerald-600" : pct >= 40 ? "h-full bg-amber-500" : "h-full bg-red-500"} style={{ width: `${pct}%` }} />
                          </div>
                          <span className="w-9 text-right text-xs text-zinc-500 tabular-nums">{pct}%</span>
                        </div>
                      </td>
                      <td className="text-right">
                        {s.silent ? (
                          <Link href={`/states/${encodeURIComponent(s.state)}?day=${day}`} className="font-medium text-amber-700 hover:underline tabular-nums">
                            {fmtNumber(s.silent)} →
                          </Link>
                        ) : (
                          <span className="text-zinc-400">0</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-2 text-xs text-zinc-500">
          &quot;Farmers can see&quot; = prices whose listing has an approved product. &quot;Usual mandis&quot; = mandis that sent at least one price in the 7 days before this day.
        </p>
      </section>
    </>
  );
}

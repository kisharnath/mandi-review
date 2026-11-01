import Link from "next/link";
import { PageHeader, SectionTitle, StatCard } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { COLL } from "@/lib/db";
import { fmtDate, fmtDateTime, fmtNumber, titleCase } from "@/lib/format";
import { cachedBadPriceCounts, PRICE_PROBLEMS, PROBLEM_KEYS } from "@/lib/prices";
import { statistics, type GroupRow, type StatusCounts } from "@/lib/statistics";
import { stateNames } from "@/lib/stats";

export const maxDuration = 60;

const pct = (part: number, whole: number) => (whole ? Math.round((part / whole) * 100) : 0);

/** A share shown as a number and a thin bar. */
function Share({ part, whole }: { part: number; whole: number }) {
  const p = pct(part, whole);
  return (
    <div className="flex items-center justify-end gap-2">
      <span className="w-10 text-right tabular-nums">{p}%</span>
      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-zinc-100">
        <div className={p >= 90 ? "h-full bg-emerald-600" : p >= 50 ? "h-full bg-amber-500" : "h-full bg-red-500"} style={{ width: `${p}%` }} />
      </div>
    </div>
  );
}

function LinkStatus({ title, counts, href }: { title: string; counts: StatusCounts; href: string }) {
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const rows = [
    { key: "approved", label: "Approved", cls: "bg-emerald-600" },
    { key: "pending", label: "Pending", cls: "bg-amber-500" },
    { key: "rejected", label: "Rejected", cls: "bg-zinc-400" },
  ];
  return (
    <Link href={href} className="card block p-4 transition-colors hover:border-emerald-300">
      <div className="mb-2 flex items-baseline justify-between">
        <span className="text-sm font-semibold text-zinc-800">{title}</span>
        <span className="text-xs text-zinc-500 tabular-nums">{fmtNumber(total)}</span>
      </div>
      <div className="mb-3 flex h-2 overflow-hidden rounded-full bg-zinc-100">
        {rows.map((r) => <div key={r.key} className={r.cls} style={{ width: `${pct(counts[r.key] ?? 0, total)}%` }} />)}
      </div>
      <div className="space-y-1 text-sm">
        {rows.map((r) => (
          <div key={r.key} className="flex justify-between">
            <span className="flex items-center gap-2 text-zinc-600"><span className={`h-2 w-2 rounded-full ${r.cls}`} />{r.label}</span>
            <span className="tabular-nums">{fmtNumber(counts[r.key] ?? 0)}</span>
          </div>
        ))}
      </div>
    </Link>
  );
}

function GroupTable({ rows, label, name, prices }: { rows: GroupRow[]; label: string; name: (k: string) => string; prices?: Map<string, number> }) {
  return (
    <div className="card overflow-x-auto">
      <table className="table-base">
        <thead>
          <tr>
            <th>{label}</th>
            <th className="text-right">Listings</th>
            {prices && <th className="text-right">Prices, last 30 days</th>}
            <th className="text-right">With product</th>
            <th className="text-right">With mandi</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <td className="font-medium">{name(r.key)}</td>
              <td className="text-right tabular-nums">{fmtNumber(r.listings)}</td>
              {prices && <td className="text-right tabular-nums">{fmtNumber(prices.get(r.key) ?? 0)}</td>}
              <td><Share part={r.withProduct} whole={r.listings} /></td>
              <td><Share part={r.withMandi} whole={r.listings} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function StatisticsPage() {
  await requireUser();
  const [s, bad, names] = await Promise.all([statistics(), cachedBadPriceCounts(), stateNames()]);
  const badTotal = PROBLEM_KEYS.reduce((n, k) => n + (bad[k] ?? 0), 0);
  const listingsWithProduct = s.byState.reduce((n, r) => n + r.withProduct, 0);
  const listingsWithMandi = s.byState.reduce((n, r) => n + r.withMandi, 0);
  const maxDay = Math.max(1, ...s.pricesPerDay.map((d) => d.prices));
  const last30 = s.pricesPerDay.reduce((n, d) => n + d.prices, 0);
  const emptyDays = s.pricesPerDay.filter((d) => d.prices === 0).length;

  return (
    <>
      <PageHeader title="Statistics" description={`The whole v2 database at a glance. Numbers refresh every 10 minutes (last ${fmtDateTime(s.generatedAt)}).`} />

      <div className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Prices saved" value={fmtNumber(s.totals.prices)} hint={`${fmtNumber(last30)} in the last 30 days`} href={`/data/${COLL.prices}`} />
        <StatCard
          label="Listings farmers can see"
          value={`${pct(listingsWithProduct, s.totals.listings)}%`}
          hint={`${fmtNumber(listingsWithProduct)} of ${fmtNumber(s.totals.listings)} have an approved product`}
          tone={pct(listingsWithProduct, s.totals.listings) < 90 ? "warn" : undefined}
          href="/mapping"
        />
        <StatCard label="Listings tied to a mandi" value={`${pct(listingsWithMandi, s.totals.listings)}%`} hint={`${fmtNumber(listingsWithMandi)} listings`} href="/mandi-links" />
        <StatCard label="Wrong prices" value={fmtNumber(badTotal)} hint={`${fmtNumber(s.totals.deletedPrices)} deleted so far`} tone={badTotal ? "bad" : undefined} href="/prices" />
        <StatCard label="Mandis" value={fmtNumber(s.totals.mandis)} hint={`${pct(s.totals.mandisWithLocation, s.totals.mandis)}% have a location`} href={`/data/${COLL.mandis}`} />
        <StatCard label="Crops" value={fmtNumber(s.totals.crops)} hint={`${fmtNumber(s.totals.products)} products`} href="/crops" />
        <StatCard label="Days with no prices" value={fmtNumber(emptyDays)} hint="in the last 30 days" tone={emptyDays ? "warn" : undefined} />
        <StatCard label="Modal price only" value={fmtNumber(s.missingMinMax)} hint="no min or max; normal for some sources" />
      </div>

      <section className="mb-8">
        <SectionTitle>Prices saved per day, last 30 days</SectionTitle>
        <div className="card p-4">
          <div className="flex h-40 items-end gap-1">
            {s.pricesPerDay.map((d) => (
              <div key={d.day} className="group relative flex h-full flex-1 items-end" title={`${fmtDate(d.day)}: ${fmtNumber(d.prices)} prices`}>
                <div className={d.prices ? "w-full rounded-t bg-emerald-600 group-hover:bg-emerald-800" : "w-full border-b-2 border-red-400"} style={{ height: `${Math.max(d.prices ? 2 : 0, (d.prices / maxDay) * 100)}%` }} />
              </div>
            ))}
          </div>
          <div className="mt-2 flex justify-between text-xs text-zinc-500">
            <span>{fmtDate(s.pricesPerDay[0]?.day)}</span>
            <span>busiest day {fmtNumber(maxDay)} prices</span>
            <span>{fmtDate(s.pricesPerDay.at(-1)?.day)}</span>
          </div>
        </div>
      </section>

      <section className="mb-8">
        <SectionTitle aside={<Link href="/prices" className="text-xs font-medium text-emerald-700 hover:underline">Fix or delete →</Link>}>Wrong prices by problem</SectionTitle>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
          {PROBLEM_KEYS.map((k) => (
            <StatCard key={k} label={PRICE_PROBLEMS[k].label} value={fmtNumber(bad[k])} hint={PRICE_PROBLEMS[k].deleteAll ? PRICE_PROBLEMS[k].hint : "real prices; the Meghalaya scraper does not read the modal yet"} tone={bad[k] ? (PRICE_PROBLEMS[k].deleteAll ? "bad" : "warn") : undefined} href={`/prices?problem=${k}`} />
          ))}
        </div>
      </section>

      <section className="mb-8">
        <SectionTitle>Name links</SectionTitle>
        <div className="grid gap-4 md:grid-cols-3">
          <LinkStatus title="Crop names" counts={s.links.cropNames} href="/mapping" />
          <LinkStatus title="Mandi names" counts={s.links.mandiNames} href="/mandi-links" />
          <LinkStatus title="Farmer words" counts={s.links.cropWords} href="/crop-words" />
        </div>
      </section>

      <section className="mb-8">
        <SectionTitle>By source</SectionTitle>
        <GroupTable rows={s.bySource} label="Source" name={(k) => k} prices={new Map(s.pricesBySource30d.map((r) => [r.key, r.prices]))} />
      </section>

      <section className="mb-8">
        <SectionTitle>By state</SectionTitle>
        <GroupTable rows={s.byState} label="State" name={(k) => titleCase(names[k] ?? k)} />
      </section>

      <section>
        <SectionTitle>Mandis by state</SectionTitle>
        <div className="card overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr><th>State</th><th className="text-right">Mandis</th><th className="text-right">With location</th></tr>
            </thead>
            <tbody>
              {s.mandisByState.map((r) => (
                <tr key={r.key}>
                  <td className="font-medium">{titleCase(r.key)}</td>
                  <td className="text-right tabular-nums">{fmtNumber(r.mandis)}</td>
                  <td><Share part={r.withLocation} whole={r.mandis} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

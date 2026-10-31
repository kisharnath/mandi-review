import Link from "next/link";
import { PageHeader } from "@/components/ui";
import { collectionSummaries } from "@/lib/browse";
import { getDb } from "@/lib/db";
import { fmtNumber } from "@/lib/format";

export default async function DataPage() {
  const list = await collectionSummaries(await getDb());
  const known = list.filter((c) => c.def).sort((a, b) => a.def!.label.localeCompare(b.def!.label));
  const other = list.filter((c) => !c.def).sort((a, b) => a.name.localeCompare(b.name));

  return (
    <>
      <PageHeader title="All data" description="Every collection in the price database. Open one to search, filter and page through it." />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {known.map((c) => (
          <Link key={c.name} href={`/data/${c.name}`} className="card block p-5 transition-colors hover:border-emerald-300">
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-semibold text-zinc-900">{c.def!.label}</span>
              <span className="text-sm text-zinc-500 tabular-nums">{fmtNumber(c.count)}</span>
            </div>
            <div className="mt-0.5 font-mono text-xs text-zinc-400">{c.name}</div>
            <p className="mt-2 text-sm text-zinc-600">{c.def!.description}</p>
          </Link>
        ))}
      </div>
      {other.length > 0 && (
        <>
          <h2 className="mt-8 mb-2 text-sm font-semibold text-zinc-800">Other collections</h2>
          <div className="card divide-y divide-zinc-100">
            {other.map((c) => (
              <Link key={c.name} href={`/data/${c.name}`} className="flex justify-between px-4 py-2.5 text-sm hover:bg-zinc-50">
                <span className="font-mono text-zinc-700">{c.name}</span>
                <span className="text-zinc-500 tabular-nums">{fmtNumber(c.count)}</span>
              </Link>
            ))}
          </div>
        </>
      )}
    </>
  );
}

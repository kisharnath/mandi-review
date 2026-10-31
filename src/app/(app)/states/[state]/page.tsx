import Link from "next/link";
import { Empty, PageHeader } from "@/components/ui";
import { COLL } from "@/lib/db";
import { first, fmtDate, titleCase } from "@/lib/format";
import { latestPriceDay, silentMandis, stateNames } from "@/lib/stats";

export const maxDuration = 60;

export default async function StatePage({ params, searchParams }: {
  params: Promise<{ state: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { state: raw } = await params;
  const state = decodeURIComponent(raw);
  const sp = await searchParams;
  const day = first(sp.day) || (await latestPriceDay());
  const rows = await silentMandis(state, day);
  const label = (await stateNames())[state] ?? state;

  return (
    <>
      <PageHeader
        title={`${titleCase(label)}: mandis missing on ${fmtDate(day)}`}
        description="These mandis sent prices in the 7 days before, but nothing on this day. Check whether the source site is down or the mandi was closed."
        actions={<Link href={`/?day=${day}`} className="btn-secondary">← Back to today</Link>}
      />
      {rows.length === 0 ? (
        <Empty title="Every usual mandi reported on this day" />
      ) : (
        <div className="card overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr><th>Mandi</th><th>Last price received</th><th /></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="font-medium">{titleCase(r.name)}</td>
                  <td>{fmtDate(r.lastDate)}</td>
                  <td className="text-right">
                    <Link className="text-xs font-medium text-emerald-700 hover:underline" href={`/data/${COLL.prices}?q=${encodeURIComponent(r.name)}`}>
                      See its prices →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

import Link from "next/link";
import { notFound } from "next/navigation";
import { Cell } from "@/components/cell";
import { DateFilter, FilterSelect, SearchBox } from "@/components/client";
import { Pagination } from "@/components/pagination";
import { Empty, PageHeader } from "@/components/ui";
import { browse, PAGE_SIZE } from "@/lib/browse";
import { getDb } from "@/lib/db";
import { first, titleCase } from "@/lib/format";

export const maxDuration = 60;

export default async function CollectionPage({ params, searchParams }: {
  params: Promise<{ collection: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { collection } = await params;
  const name = decodeURIComponent(collection);
  const sp = await searchParams;
  const db = await getDb();
  const exists = await db.listCollections({ name }, { nameOnly: true }).hasNext();
  if (!exists) notFound();

  const filters: Record<string, string> = {};
  for (const [k, v] of Object.entries(sp)) if (typeof v === "string" && !["q", "page", "msg", "err"].includes(k)) filters[k] = v;
  const page = Math.max(1, Number(first(sp.page)) || 1);
  const res = await browse(db, name, { q: first(sp.q), page, filters });
  const { def } = res;

  return (
    <>
      <PageHeader
        title={def.label}
        description={<>{def.description} <span className="font-mono text-xs text-zinc-400">({name})</span></>}
        actions={<Link href="/data" className="btn-secondary">← All data</Link>}
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <SearchBox placeholder={def.searchVia === "listings" ? "Search by crop or mandi name…" : def.searchFields.length ? `Search ${def.searchFields.join(", ").replace(/_/g, " ")}…` : "Search by id…"} />
        {def.filters.map((f) =>
          f.type === "date" ? (
            <DateFilter key={f.key} param={f.key} label={f.label} />
          ) : f.type === "nullable" ? (
            <FilterSelect key={f.key} param={f.key} label={f.label} options={[{ value: "missing", label: "Missing" }, { value: "present", label: "Present" }]} />
          ) : (
            <FilterSelect
              key={f.key}
              param={f.key}
              label={f.label}
              options={(res.filterOptions[f.key] ?? []).map((v) => ({ value: v, label: v === "true" ? "Yes" : v === "false" ? "No" : titleCase(v) }))}
            />
          ),
        )}
      </div>

      {res.rows.length === 0 ? (
        <Empty title="No rows match" />
      ) : (
        <div className="card max-h-[calc(100vh-17rem)] overflow-auto">
          <table className="table-base">
            <thead>
              <tr>
                {def.columns.map((c) => <th key={c.key}>{c.label}</th>)}
                <th />
              </tr>
            </thead>
            <tbody>
              {res.rows.map((row) => (
                <tr key={String(row._id)}>
                  {def.columns.map((c) => (
                    <td key={c.key}>
                      <Cell row={row} col={c} collection={name} productNames={res.productNames} mandiNames={res.mandiNames} />
                    </td>
                  ))}
                  <td className="text-right">
                    <Link className="text-xs font-medium whitespace-nowrap text-emerald-700 hover:underline" href={`/data/${name}/${String(row._id)}`}>Details</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pagination page={page} pageSize={PAGE_SIZE} total={res.total} estimate={res.totalIsEstimate} />
    </>
  );
}

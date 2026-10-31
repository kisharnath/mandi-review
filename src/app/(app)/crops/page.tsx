import Link from "next/link";
import { createCropAction } from "@/app/actions";
import { SearchBox, SubmitButton } from "@/components/client";
import { Badge, Flash, PageHeader } from "@/components/ui";
import { canEdit, requireUser } from "@/lib/auth";
import type { CropDoc, ProductDoc } from "@/lib/catalog";
import { COLL, getDb, MAX_TIME_MS } from "@/lib/db";
import { escapeRegex, first, fmtNumber, titleCase } from "@/lib/format";

export const maxDuration = 60;

export default async function CropsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const user = await requireUser();
  const q = first(sp.q).trim();
  const db = await getDb();

  const rx = q ? { $regex: escapeRegex(q), $options: "i" } : null;
  const productMatches = rx ? await db.collection<ProductDoc>(COLL.products).distinct("crop_id", { name: rx }) : [];
  const crops = await db
    .collection<CropDoc>(COLL.crops)
    .find(rx ? { $or: [{ name: rx }, { _id: { $in: productMatches } }] } : {})
    .sort({ name: 1 })
    .limit(1000)
    .maxTimeMS(MAX_TIME_MS)
    .toArray();
  const [products, nameCounts, listingCounts] = await Promise.all([
    db.collection<ProductDoc>(COLL.products).find({ crop_id: { $in: crops.map((c) => c._id) } }).toArray(),
    db.collection(COLL.cropNames).aggregate<{ _id: unknown; n: number }>([{ $match: { status: "approved" } }, { $group: { _id: "$product_id", n: { $sum: 1 } } }]).toArray(),
    db.collection(COLL.listings).aggregate<{ _id: unknown; n: number }>([{ $match: { product_id: { $ne: null } } }, { $group: { _id: "$product_id", n: { $sum: 1 } } }], { maxTimeMS: MAX_TIME_MS }).toArray(),
  ]);
  const names = new Map(nameCounts.map((c) => [String(c._id), c.n]));
  const listings = new Map(listingCounts.map((c) => [String(c._id), c.n]));

  return (
    <>
      <PageHeader
        title="Crops and products"
        description="Each crop has one or more products (for example paddy → ordinary paddy, basmati paddy). When a farmer names only the crop, the default product is used."
      />
      <Flash msg={first(sp.msg)} err={first(sp.err)} />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <SearchBox placeholder="Search crop or product…" />
        {canEdit(user) && (
          <details className="relative">
            <summary className="btn-primary cursor-pointer list-none">New crop</summary>
            <form action={createCropAction} className="card absolute right-0 z-20 mt-2 w-80 space-y-3 p-4">
              <input type="hidden" name="back" value="/crops" />
              <div>
                <label className="label" htmlFor="name">Crop name</label>
                <input id="name" name="name" className="input" required placeholder="e.g. green chilli" />
              </div>
              <div>
                <label className="label" htmlFor="notes">Note (optional)</label>
                <input id="notes" name="notes" className="input" />
              </div>
              <SubmitButton>Create</SubmitButton>
            </form>
          </details>
        )}
      </div>

      <div className="card overflow-x-auto">
        <table className="table-base">
          <thead>
            <tr><th>Crop</th><th>Products</th><th className="text-right">Approved names</th><th className="text-right">Listings</th><th /></tr>
          </thead>
          <tbody>
            {crops.map((c) => {
              const own = products.filter((p) => String(p.crop_id) === String(c._id));
              const nNames = own.reduce((a, p) => a + (names.get(String(p._id)) ?? 0), 0);
              const nListings = own.reduce((a, p) => a + (listings.get(String(p._id)) ?? 0), 0);
              return (
                <tr key={String(c._id)}>
                  <td className="font-medium whitespace-nowrap">
                    <Link className="text-zinc-900 hover:text-emerald-700 hover:underline" href={`/crops/${String(c._id)}`}>{titleCase(c.name)}</Link>
                    {c.active === false && <span className="ml-2"><Badge>Off</Badge></span>}
                  </td>
                  <td className="text-xs text-zinc-600">
                    {own.map((p, i) => (
                      <span key={String(p._id)}>
                        {i > 0 && ", "}
                        {titleCase(p.name)}
                        {String(c.default_product_id) === String(p._id) && <span className="text-emerald-700"> (default)</span>}
                      </span>
                    ))}
                  </td>
                  <td className="text-right tabular-nums">{fmtNumber(nNames)}</td>
                  <td className="text-right tabular-nums">{fmtNumber(nListings)}</td>
                  <td className="text-right"><Link className="text-xs font-medium text-emerald-700 hover:underline" href={`/crops/${String(c._id)}`}>Open →</Link></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-zinc-500">{fmtNumber(crops.length)} crops</p>
    </>
  );
}

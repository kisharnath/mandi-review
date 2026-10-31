import Link from "next/link";
import { notFound } from "next/navigation";
import { createProductAction, updateCropAction, updateProductAction } from "@/app/actions";
import { SubmitButton } from "@/components/client";
import { Badge, Flash, PageHeader, SectionTitle } from "@/components/ui";
import { canEdit, requireUser } from "@/lib/auth";
import type { CropDoc, CropNameDoc, ProductDoc } from "@/lib/catalog";
import { COLL, getDb, MAX_TIME_MS } from "@/lib/db";
import { first, fmtNumber, titleCase, toObjectId } from "@/lib/format";
import { looksWrong } from "@/lib/heuristics";

export const maxDuration = 60;

export default async function CropPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const oid = toObjectId(id);
  if (!oid) notFound();
  const user = await requireUser();
  const editor = canEdit(user);
  const db = await getDb();
  const crop = await db.collection<CropDoc>(COLL.crops).findOne({ _id: oid });
  if (!crop) notFound();

  const products = await db.collection<ProductDoc>(COLL.products).find({ crop_id: oid }).sort({ name: 1 }).toArray();
  const pids = products.map((p) => p._id);
  const [names, listingCounts] = await Promise.all([
    db.collection<CropNameDoc>(COLL.cropNames).find({ product_id: { $in: pids } }).sort({ listings: -1 }).limit(500).toArray(),
    db.collection(COLL.listings).aggregate<{ _id: unknown; n: number }>([{ $match: { product_id: { $in: pids } } }, { $group: { _id: "$product_id", n: { $sum: 1 } } }], { maxTimeMS: MAX_TIME_MS }).toArray(),
  ]);
  const listingsOf = new Map(listingCounts.map((c) => [String(c._id), c.n]));
  const back = `/crops/${id}`;

  return (
    <>
      <PageHeader
        title={titleCase(crop.name)}
        description="Products of this crop, the default used when a farmer names only the crop, and every source name approved for each product."
        actions={<Link href="/crops" className="btn-secondary">← All crops</Link>}
      />
      <Flash msg={first(sp.msg)} err={first(sp.err)} />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {products.map((p) => {
            const own = names.filter((n) => String(n.product_id) === String(p._id));
            const isDefault = String(crop.default_product_id) === String(p._id);
            return (
              <div key={String(p._id)} className="card overflow-hidden">
                <div className="flex flex-wrap items-center gap-2 border-b border-zinc-100 px-4 py-3">
                  <span className="font-semibold text-zinc-900">{titleCase(p.name)}</span>
                  {isDefault && <Badge tone="green">Default</Badge>}
                  {p.form === "processed" && <Badge>Processed</Badge>}
                  {p.active === false && <Badge tone="red">Off</Badge>}
                  <span className="ml-auto text-xs text-zinc-500">{fmtNumber(listingsOf.get(String(p._id)) ?? 0)} listings</span>
                </div>
                {own.length === 0 ? (
                  <p className="px-4 py-3 text-sm text-zinc-500">No source names linked yet.</p>
                ) : (
                  <table className="table-base">
                    <tbody>
                      {own.map((n) => (
                        <tr key={String(n._id)}>
                          <td>
                            <Link href={`/mapping?status=all&q=${encodeURIComponent(n.raw_name)}&id=${String(n._id)}`} className="font-medium text-zinc-900 hover:text-emerald-700 hover:underline">
                              {n.raw_name}
                            </Link>
                            {n.raw_variety !== "*" && <span className="ml-1 text-xs text-zinc-500">variety {n.raw_variety}</span>}
                            <div className="mt-0.5 flex gap-1">
                              {n.needs_check && <Badge tone="blue">Approved by migration</Badge>}
                              {looksWrong(n.raw_name, crop.name, [p.name]) && <Badge tone="violet">Looks wrong</Badge>}
                            </div>
                          </td>
                          <td className="text-xs text-zinc-500">{n.source}</td>
                          <td className="text-right text-xs text-zinc-500 tabular-nums">{fmtNumber(n.listings ?? 0)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                {editor && (
                  <form action={updateProductAction} className="flex flex-wrap items-center gap-2 border-t border-zinc-100 bg-zinc-50/60 px-4 py-2.5">
                    <input type="hidden" name="back" value={back} />
                    <input type="hidden" name="productId" value={String(p._id)} />
                    <input name="name" className="input w-48 py-1" defaultValue={p.name} aria-label="Product name" />
                    <select name="form" className="input w-auto py-1" defaultValue={p.form ?? "raw"} aria-label="Form">
                      <option value="raw">Raw</option>
                      <option value="processed">Processed</option>
                    </select>
                    <select name="active" className="input w-auto py-1" defaultValue={p.active === false ? "false" : "true"} aria-label="Active">
                      <option value="true">On</option>
                      <option value="false">Off</option>
                    </select>
                    <SubmitButton className="btn-secondary">Save</SubmitButton>
                  </form>
                )}
              </div>
            );
          })}
        </div>

        {editor && (
          <div className="space-y-4">
            <form action={updateCropAction} className="card space-y-3 p-5">
              <SectionTitle>Crop</SectionTitle>
              <input type="hidden" name="back" value={back} />
              <input type="hidden" name="cropId" value={id} />
              <div>
                <label className="label" htmlFor="name">Name</label>
                <input id="name" name="name" className="input" defaultValue={crop.name} required />
              </div>
              <div>
                <label className="label" htmlFor="defaultProductId">Default product (when a farmer names only the crop)</label>
                <select id="defaultProductId" name="defaultProductId" className="input" defaultValue={String(crop.default_product_id ?? "")}>
                  {products.map((p) => <option key={String(p._id)} value={String(p._id)}>{titleCase(p.name)}</option>)}
                </select>
              </div>
              <div>
                <label className="label" htmlFor="notes">Note</label>
                <textarea id="notes" name="notes" className="input min-h-16" defaultValue={crop.notes ?? ""} />
              </div>
              <div>
                <label className="label" htmlFor="active">Status</label>
                <select id="active" name="active" className="input" defaultValue={crop.active === false ? "false" : "true"}>
                  <option value="true">On</option>
                  <option value="false">Off (hidden from farmers)</option>
                </select>
              </div>
              <SubmitButton>Save</SubmitButton>
            </form>
            <form action={createProductAction} className="card space-y-3 p-5">
              <SectionTitle>Add a product</SectionTitle>
              <input type="hidden" name="back" value={back} />
              <input type="hidden" name="cropId" value={id} />
              <input name="name" className="input" placeholder={`e.g. basmati ${crop.name}`} required />
              <select name="form" className="input" defaultValue="raw">
                <option value="raw">Raw produce</option>
                <option value="processed">Processed</option>
              </select>
              <SubmitButton className="btn-secondary">Add</SubmitButton>
            </form>
          </div>
        )}
      </div>
    </>
  );
}

import Link from "next/link";
import { notFound } from "next/navigation";
import { updateMandiAction } from "@/app/actions";
import { SubmitButton } from "@/components/client";
import { Flash, PageHeader, SectionTitle } from "@/components/ui";
import { canEdit, requireUser } from "@/lib/auth";
import { COLL, getDb, MAX_TIME_MS } from "@/lib/db";
import { first, fmtNumber, titleCase, toObjectId } from "@/lib/format";
import { MANDI_EDITS_ENABLED } from "@/lib/mandis";

export default async function MandiPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const oid = toObjectId(id);
  if (!oid) notFound();
  const user = await requireUser();
  const db = await getDb();
  const mandi = await db.collection(COLL.mandis).findOne({ _id: oid });
  if (!mandi) notFound();
  const crops = await db
    .collection(COLL.listings)
    .aggregate<{ _id: string; n: number }>([{ $match: { mandi_id: oid } }, { $group: { _id: "$commodity_name", n: { $sum: 1 } } }, { $sort: { _id: 1 } }], { maxTimeMS: MAX_TIME_MS })
    .toArray();
  const [lon, lat] = (mandi.location?.coordinates as number[] | undefined) ?? [];

  return (
    <>
      <PageHeader
        title={titleCase(mandi.name)}
        description={[titleCase(mandi.district), titleCase(mandi.state), mandi.postcode].filter(Boolean).join(" · ")}
        actions={<Link href={`/data/${COLL.mandis}`} className="btn-secondary">← All mandis</Link>}
      />
      <Flash msg={first(sp.msg)} err={first(sp.err)} />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="card p-5 lg:col-span-2">
          <SectionTitle>Crops sold here ({fmtNumber(crops.length)})</SectionTitle>
          {crops.length === 0 ? (
            <p className="text-sm text-zinc-500">No listings point to this mandi.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {crops.map((c) => (
                <Link key={c._id} href={`/mapping?status=all&q=${encodeURIComponent(c._id)}`} className="rounded-full bg-zinc-100 px-2.5 py-1 text-xs text-zinc-700 hover:bg-emerald-50 hover:text-emerald-800">
                  {c._id}
                </Link>
              ))}
            </div>
          )}
          {(mandi.aliases as string[] | undefined)?.length ? (
            <p className="mt-4 text-xs text-zinc-500">Other names: {(mandi.aliases as string[]).join(", ")}</p>
          ) : null}
        </div>
        {canEdit(user) && MANDI_EDITS_ENABLED ? (
          <form action={updateMandiAction} className="card space-y-3 p-5">
            <SectionTitle>Edit</SectionTitle>
            <input type="hidden" name="back" value={`/mandis/${id}`} />
            <input type="hidden" name="mandiId" value={id} />
            <div>
              <label className="label" htmlFor="district">District</label>
              <input id="district" name="district" className="input" defaultValue={mandi.district ?? ""} />
            </div>
            <div>
              <label className="label" htmlFor="postcode">Postcode</label>
              <input id="postcode" name="postcode" className="input" defaultValue={mandi.postcode ?? ""} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="label" htmlFor="lat">Latitude</label>
                <input id="lat" name="lat" className="input" defaultValue={lat ?? ""} />
              </div>
              <div>
                <label className="label" htmlFor="lon">Longitude</label>
                <input id="lon" name="lon" className="input" defaultValue={lon ?? ""} />
              </div>
            </div>
            {lat !== undefined && (
              <a className="block text-xs font-medium text-emerald-700 hover:underline" target="_blank" rel="noreferrer" href={`https://www.google.com/maps?q=${lat},${lon}`}>
                Check location on the map ↗
              </a>
            )}
            <SubmitButton>Save</SubmitButton>
          </form>
        ) : null}
      </div>
    </>
  );
}

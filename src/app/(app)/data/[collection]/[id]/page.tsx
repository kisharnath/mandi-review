import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader, SectionTitle } from "@/components/ui";
import { collectionDef } from "@/lib/collections";
import { COLL, getDb } from "@/lib/db";
import { plain, toObjectId } from "@/lib/format";

/** One document, in full, with links to the records it points at. */
export default async function DocumentPage({ params }: { params: Promise<{ collection: string; id: string }> }) {
  const { collection, id } = await params;
  const name = decodeURIComponent(collection);
  const db = await getDb();
  const oid = toObjectId(id);
  const doc = await db.collection(name).findOne(oid ? { _id: oid } : ({ _id: id } as never));
  if (!doc) notFound();
  const data = plain<Record<string, unknown>>(doc);

  const links: { label: string; href: string }[] = [];
  const add = (label: string, href: string) => links.push({ label, href });
  if (data.commodity_alias_lookup_id) add("Crop group", `/groups/${data.commodity_alias_lookup_id}`);
  if (data.market_id) add("Mandi", `/mandis/${data.market_id}`);
  if (data.market_commodity_id) add("Listing", `/data/${COLL.markets}/${data.market_commodity_id}`);
  if (typeof data.commodity_name === "string") add("Crop matching", `/mapping?name=${encodeURIComponent(data.commodity_name)}`);
  if (name === COLL.markets) add("Prices for this listing", `/data/${COLL.prices}?q=${id}`);
  if (name === COLL.groups) add("Open group", `/groups/${id}`);
  if (name === COLL.mandis) add("Open mandi", `/mandis/${id}`);

  return (
    <>
      <PageHeader
        title={collectionDef(name)?.label ?? name}
        description={<span className="font-mono text-xs">{id}</span>}
        actions={<Link href={`/data/${name}`} className="btn-secondary">← Back to table</Link>}
      />
      {links.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-2">
          {links.map((l) => <Link key={l.href} href={l.href} className="btn-secondary">{l.label} →</Link>)}
        </div>
      )}
      <div className="card p-5">
        <SectionTitle>All fields</SectionTitle>
        <pre className="overflow-x-auto rounded-lg bg-zinc-50 p-4 font-mono text-xs leading-relaxed text-zinc-800">{JSON.stringify(data, null, 2)}</pre>
      </div>
    </>
  );
}

import clsx from "clsx";
import Link from "next/link";
import type { Filter, ObjectId } from "mongodb";
import { addVarietyAction, createCropAction, createProductAction, decideCropNameAction } from "@/app/actions";
import { FilterSelect, Picker, SearchBox, SubmitButton, Tabs } from "@/components/client";
import { Badge, Empty, Flash, PageHeader, SectionTitle } from "@/components/ui";
import { canEdit, requireUser } from "@/lib/auth";
import { ANY_VARIETY, type CropDoc, type CropNameDoc, type ProductDoc } from "@/lib/catalog";
import { COLL, getDb, MAX_TIME_MS } from "@/lib/db";
import { escapeRegex, first, fmtDate, fmtDateTime, fmtNumber, titleCase, toObjectId } from "@/lib/format";
import { looksWrong } from "@/lib/heuristics";

export const maxDuration = 60;
const LIST_LIMIT = 400;

const STATUS_TABS = [
  { value: "pending", label: "Pending" },
  { value: "check", label: "Double-check" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
  { value: "all", label: "All" },
];

type Row = CropNameDoc & { productLabel: string | null; suggestionLabel: string | null; wrong: boolean };

export default async function CropNamesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const user = await requireUser();
  const editor = canEdit(user);
  const db = await getDb();

  const status = first(sp.status) || "pending";
  const source = first(sp.source);
  const q = first(sp.q).trim();
  const wrongOnly = first(sp.flag) === "wrong";
  const selectedId = toObjectId(first(sp.id));

  const filter: Filter<CropNameDoc> = {};
  if (status === "check") Object.assign(filter, { status: "approved", needs_check: true });
  else if (status !== "all") filter.status = status as CropNameDoc["status"];
  if (source) filter.source = source;
  if (q) filter.raw_name = { $regex: escapeRegex(q), $options: "i" };

  const coll = db.collection<CropNameDoc>(COLL.cropNames);
  const [docs, counts, sources, products, crops] = await Promise.all([
    coll.find(filter).sort({ listings: -1, raw_name: 1 }).limit(LIST_LIMIT).maxTimeMS(MAX_TIME_MS).toArray(),
    coll.aggregate<{ _id: string; n: number }>([{ $group: { _id: "$status", n: { $sum: 1 } } }]).toArray(),
    coll.distinct("source"),
    db.collection<ProductDoc>(COLL.products).find({}, { projection: { name: 1, crop_id: 1 } }).toArray(),
    db.collection<CropDoc>(COLL.crops).find({}, { projection: { name: 1, default_product_id: 1 } }).toArray(),
  ]);
  const checkCount = await coll.countDocuments({ status: "approved", needs_check: true });
  const cropById = new Map(crops.map((c) => [String(c._id), c]));
  const productById = new Map(products.map((p) => [String(p._id), p]));
  const label = (pid: unknown) => {
    const p = pid ? productById.get(String(pid)) : undefined;
    if (!p) return null;
    const crop = cropById.get(String(p.crop_id));
    return crop && crop.name !== p.name ? `${crop.name} / ${p.name}` : p.name;
  };
  let rows: Row[] = docs.map((d) => {
    const p = d.product_id ? productById.get(String(d.product_id)) : undefined;
    const crop = p ? cropById.get(String(p.crop_id)) : undefined;
    return {
      ...d,
      productLabel: label(d.product_id),
      suggestionLabel: d.suggestion?.product_name ?? label(d.suggestion?.product_id),
      wrong: !!p && looksWrong(d.raw_name, crop?.name ?? p.name, [p.name]),
    };
  });
  if (wrongOnly) rows = rows.filter((r) => r.wrong);
  const countOf = (s: string) => counts.find((c) => c._id === s)?.n ?? 0;

  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) if (typeof v === "string" && v && k !== "msg" && k !== "err") qs.set(k, v);
  const back = `/mapping?${qs}`;
  const linkFor = (id: unknown) => {
    const next = new URLSearchParams(qs);
    next.set("id", String(id));
    return `/mapping?${next}`;
  };
  const selected = selectedId ? await coll.findOne({ _id: selectedId }) : null;

  return (
    <>
      <PageHeader
        title="Crop names"
        description="Each crop name a source uses, and the product it means. Farmers only see prices for names that a person has approved."
      />
      <Flash msg={first(sp.msg)} err={first(sp.err)} />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Tabs
          param="status"
          tabs={STATUS_TABS.map((t) => ({
            ...t,
            count: t.value === "check" ? checkCount : t.value === "all" ? counts.reduce((a, c) => a + c.n, 0) : countOf(t.value),
          }))}
        />
        <FilterSelect param="source" label="Source" options={sources.sort().map((s) => ({ value: s, label: s }))} />
        <FilterSelect param="flag" label="Show" allLabel="Everything" options={[{ value: "wrong", label: "Only ones that look wrong" }]} />
        <SearchBox placeholder="Search crop name…" />
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div className="card h-[calc(100vh-15rem)] overflow-y-auto">
          {rows.length === 0 ? (
            <div className="p-6 text-sm text-zinc-500">Nothing here.</div>
          ) : (
            <ul className="divide-y divide-zinc-100">
              {rows.map((r) => (
                <li key={String(r._id)}>
                  <Link
                    href={linkFor(r._id)}
                    scroll={false}
                    className={clsx("block px-4 py-2.5 hover:bg-zinc-50", selectedId && String(r._id) === String(selectedId) && "bg-emerald-50 hover:bg-emerald-50")}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="font-medium break-words text-zinc-900">
                        {r.raw_name}
                        {r.raw_variety !== ANY_VARIETY && <span className="ml-1 text-xs text-zinc-500">variety {r.raw_variety}</span>}
                      </span>
                      <span className="shrink-0 text-xs text-zinc-500 tabular-nums">{fmtNumber(r.listings ?? 0)}</span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
                      <span className="text-zinc-400">{r.source}</span>
                      <StatusBadge status={r.status} check={r.needs_check} />
                      {r.productLabel && <span className="text-zinc-700">→ {titleCase(r.productLabel)}</span>}
                      {!r.productLabel && r.suggestionLabel && <span className="text-zinc-500">guess: {titleCase(r.suggestionLabel)}</span>}
                      {r.wrong && <Badge tone="violet">Looks wrong</Badge>}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {docs.length === LIST_LIMIT && <div className="p-3 text-center text-xs text-zinc-500">Showing the first {LIST_LIMIT}. Search or filter to narrow.</div>}
        </div>

        <div>
          {!selected ? (
            <Empty title="Pick a crop name on the left">You will see where it is used, its latest prices, and buttons to approve or reject it.</Empty>
          ) : (
            <Detail row={selected} back={back} editor={editor} productLabel={label(selected.product_id)} suggestionLabel={selected.suggestion?.product_name ?? label(selected.suggestion?.product_id)} />
          )}
        </div>
      </div>
    </>
  );
}

function StatusBadge({ status, check }: { status: string; check?: boolean }) {
  if (status === "approved" && check) return <Badge tone="blue">Approved by migration</Badge>;
  return <Badge tone={status === "approved" ? "green" : status === "rejected" ? "red" : "amber"}>{titleCase(status)}</Badge>;
}

async function Detail({ row, back, editor, productLabel, suggestionLabel }: {
  row: CropNameDoc;
  back: string;
  editor: boolean;
  productLabel: string | null;
  suggestionLabel: string | null;
}) {
  const db = await getDb();
  const nameRx = { $regex: `^\\s*${row.raw_name.split(" ").map(escapeRegex).join("\\s+")}\\s*$`, $options: "i" };
  const listingFilter: Record<string, unknown> = { source_system: row.source, commodity_name: nameRx };
  if (row.raw_variety !== ANY_VARIETY) listingFilter.variety = { $regex: `^${escapeRegex(row.raw_variety)}$`, $options: "i" };
  const listings = await db
    .collection(COLL.listings)
    .find(listingFilter, { projection: { state: 1, market_name: 1, variety: 1 } })
    .limit(5000)
    .maxTimeMS(MAX_TIME_MS)
    .toArray();
  const ids = listings.map((l) => l._id as ObjectId);
  const [prices, siblings, varieties] = await Promise.all([
    db.collection(COLL.prices).find({ market_commodity_id: { $in: ids }, date: { $lte: new Date() } }).sort({ date: -1 }).limit(8).maxTimeMS(MAX_TIME_MS).toArray(),
    row.product_id
      ? db.collection<CropNameDoc>(COLL.cropNames).find({ product_id: row.product_id, status: "approved", _id: { $ne: row._id } }, { projection: { raw_name: 1, source: 1 } }).limit(30).toArray()
      : Promise.resolve([] as CropNameDoc[]),
    db.collection(COLL.listings).distinct("variety", { source_system: row.source, commodity_name: nameRx }),
  ]);
  const byListing = new Map(listings.map((l) => [String(l._id), l]));
  const byState = new Map<string, number>();
  for (const l of listings) byState.set(l.state ?? "unknown", (byState.get(l.state ?? "unknown") ?? 0) + 1);
  const initial = row.product_id
    ? { id: String(row.product_id), label: titleCase(productLabel ?? "") }
    : row.suggestion?.product_id
      ? { id: String(row.suggestion.product_id), label: titleCase(suggestionLabel ?? "") }
      : null;

  return (
    <div className="space-y-5">
      <div className="card p-5">
        <div className="text-xs font-medium tracking-wide text-zinc-500 uppercase">Crop name from {row.source}</div>
        <h2 className="mt-1 text-xl font-semibold break-words text-zinc-900">
          {row.raw_name}
          {row.raw_variety !== ANY_VARIETY && <span className="ml-2 text-base font-normal text-zinc-500">variety “{row.raw_variety}”</span>}
        </h2>
        <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-sm text-zinc-600">
          <span><b className="text-zinc-900 tabular-nums">{fmtNumber(listings.length)}</b> listings</span>
          <span><b className="text-zinc-900 tabular-nums">{byState.size}</b> states</span>
          <span>First seen {fmtDate(row.first_seen)}</span>
        </div>
        <div className="mt-4 rounded-lg bg-zinc-50 p-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={row.status} check={row.needs_check} />
            {row.status === "approved" && <span>Means <b>{titleCase(productLabel ?? "?")}</b></span>}
            {row.status === "pending" && <span className="text-amber-800">Farmers see no price for this name until it is approved.</span>}
            {row.status === "rejected" && <span className="text-red-800">Not a product we show. Its prices stay hidden.</span>}
          </div>
          {row.decided_by && (
            <div className="mt-1 text-xs text-zinc-500">
              Decided by {row.decided_by} · {fmtDateTime(row.decided_at)}
              {row.needs_check && " · nobody has checked this yet"}
            </div>
          )}
          {row.suggestion?.reason && (
            <div className="mt-2 text-xs text-zinc-600">
              Old system: {suggestionLabel ? <b>{titleCase(suggestionLabel)}</b> : "no match"} — {row.suggestion.reason}
            </div>
          )}
          {row.notes && <div className="mt-2 text-xs text-zinc-700">Note: {row.notes}</div>}
        </div>
        {siblings.length > 0 && (
          <div className="mt-3 text-xs text-zinc-500">Other names approved for this product: {siblings.map((s) => s.raw_name).join(", ")}</div>
        )}
      </div>

      {editor && (
        <div className="card p-5">
          <SectionTitle>Decide</SectionTitle>
          <form action={decideCropNameAction} className="space-y-3">
            <input type="hidden" name="back" value={back} />
            <input type="hidden" name="id" value={String(row._id)} />
            <div>
              <label className="label">It means this product</label>
              <Picker kind="products" name="productId" placeholder="Search products…" initial={initial} />
            </div>
            <input name="notes" className="input" placeholder="Note (optional), e.g. local name for ragi" defaultValue={row.notes ?? ""} />
            <div className="flex flex-wrap gap-2">
              <SubmitButton name="status" value="approved">{row.status === "approved" ? "Save" : "Approve"}</SubmitButton>
              {row.status !== "rejected" && (
                <SubmitButton className="btn-danger" name="status" value="rejected" confirm={`Reject "${row.raw_name}"? Its prices will stay hidden from farmers.`}>
                  Reject (not a crop we show)
                </SubmitButton>
              )}
              {row.status !== "pending" && <SubmitButton className="btn-secondary" name="status" value="pending">Back to pending</SubmitButton>}
            </div>
          </form>

          <details className="mt-5 border-t border-zinc-100 pt-4">
            <summary className="cursor-pointer text-sm font-medium text-emerald-700">The right product does not exist yet</summary>
            <div className="mt-3 grid gap-4 md:grid-cols-2">
              <form action={createProductAction} className="space-y-2 rounded-lg border border-zinc-200 p-3">
                <div className="text-sm font-medium">Add a product to an existing crop</div>
                <input type="hidden" name="back" value={back} />
                <input type="hidden" name="linkId" value={String(row._id)} />
                <Picker kind="crops" name="cropId" placeholder="Crop…" />
                <input name="name" className="input" placeholder="Product, e.g. basmati paddy" required />
                <select name="form" className="input" defaultValue="raw">
                  <option value="raw">Raw produce</option>
                  <option value="processed">Processed (rice, dal, atta…)</option>
                </select>
                <SubmitButton>Add product and approve</SubmitButton>
              </form>
              <form action={createCropAction} className="space-y-2 rounded-lg border border-zinc-200 p-3">
                <div className="text-sm font-medium">Add a new crop</div>
                <input type="hidden" name="back" value={back} />
                <input type="hidden" name="linkId" value={String(row._id)} />
                <input name="name" className="input" placeholder="Crop, e.g. poultry" required />
                <input name="notes" className="input" placeholder="Note (optional)" />
                <p className="text-xs text-zinc-500">Creates the crop with a default product of the same name.</p>
                <SubmitButton>Add crop and approve</SubmitButton>
              </form>
            </div>
          </details>

          {row.raw_variety === ANY_VARIETY && varieties.filter(Boolean).length > 1 && (
            <details className="mt-4 border-t border-zinc-100 pt-4">
              <summary className="cursor-pointer text-sm font-medium text-emerald-700">One variety means a different product</summary>
              <form action={addVarietyAction} className="mt-3 flex flex-wrap items-center gap-2">
                <input type="hidden" name="back" value={back} />
                <input type="hidden" name="id" value={String(row._id)} />
                <select name="variety" className="input w-auto" required defaultValue="">
                  <option value="" disabled>Variety…</option>
                  {varieties.filter(Boolean).map((v) => <option key={String(v)} value={String(v)}>{String(v)}</option>)}
                </select>
                <SubmitButton className="btn-secondary">Add as its own link</SubmitButton>
              </form>
            </details>
          )}
        </div>
      )}

      <div className="grid gap-5 md:grid-cols-2">
        <div className="card p-5">
          <SectionTitle>Where it is used</SectionTitle>
          <ul className="space-y-1 text-sm">
            {[...byState.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([s, n]) => (
              <li key={s} className="flex justify-between"><span>{titleCase(s)}</span><span className="text-zinc-500 tabular-nums">{fmtNumber(n)}</span></li>
            ))}
          </ul>
          <Link className="mt-3 inline-block text-xs font-medium text-emerald-700 hover:underline" href={`/data/${COLL.listings}?q=${encodeURIComponent(row.raw_name)}`}>
            See all listings →
          </Link>
        </div>
        <div className="card p-5">
          <SectionTitle>Latest prices</SectionTitle>
          {prices.length === 0 ? (
            <p className="text-sm text-zinc-500">No prices saved.</p>
          ) : (
            <ul className="space-y-1.5 text-sm">
              {prices.map((p) => {
                const l = byListing.get(String(p.market_commodity_id));
                return (
                  <li key={String(p._id)} className="flex justify-between gap-2">
                    <span className="truncate">{titleCase(l?.market_name)} <span className="text-xs text-zinc-400">{fmtDate(p.date)}</span></span>
                    <span className="font-medium tabular-nums">₹{fmtNumber(p.modal_price)}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

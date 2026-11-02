import clsx from "clsx";
import Link from "next/link";
import type { Filter } from "mongodb";
import { addCropWordAction, decideCropWordAction } from "@/app/actions";
import { FilterSelect, Picker, SearchBox, SubmitButton, Tabs } from "@/components/client";
import { Badge, Empty, Flash, PageHeader, SectionTitle } from "@/components/ui";
import { canEdit, requireUser } from "@/lib/auth";
import type { CropDoc, CropWordDoc, ProductDoc } from "@/lib/catalog";
import { COLL, getDb, MAX_TIME_MS } from "@/lib/db";
import { escapeRegex, first, fmtDateTime, fmtNumber, titleCase, toObjectId } from "@/lib/format";

export const maxDuration = 60;
const LIST_LIMIT = 500;

export default async function CropWordsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const user = await requireUser();
  const editor = canEdit(user);
  const db = await getDb();
  const status = first(sp.status) || "pending";
  const language = first(sp.language);
  const q = first(sp.q).trim();
  const selectedId = toObjectId(first(sp.id));

  const filter: Filter<CropWordDoc> = {};
  if (status === "check") Object.assign(filter, { status: "approved", needs_check: true });
  else if (status !== "all") filter.status = status as CropWordDoc["status"];
  if (language) filter.languages = language;
  if (q) filter.$or = [{ word: { $regex: escapeRegex(q), $options: "i" } }, { key: { $regex: escapeRegex(q.toLowerCase()), $options: "i" } }];

  const coll = db.collection<CropWordDoc>(COLL.cropWords);
  const [docs, counts, checkCount, languages, crops, products] = await Promise.all([
    coll.find(filter).sort({ word: 1 }).limit(LIST_LIMIT).maxTimeMS(MAX_TIME_MS).toArray(),
    coll.aggregate<{ _id: string; n: number }>([{ $group: { _id: "$status", n: { $sum: 1 } } }]).toArray(),
    coll.countDocuments({ status: "approved", needs_check: true }),
    coll.distinct("languages"),
    db.collection<CropDoc>(COLL.crops).find({}, { projection: { name: 1, default_product_id: 1 } }).toArray(),
    db.collection<ProductDoc>(COLL.products).find({}, { projection: { name: 1, crop_id: 1 } }).toArray(),
  ]);
  const cropById = new Map(crops.map((c) => [String(c._id), c]));
  const productById = new Map(products.map((p) => [String(p._id), p]));
  /** What a word means: its product, or (no product) its crop's default product. */
  const meaning = (w: Pick<CropWordDoc, "crop_id" | "product_id">) => {
    const crop = w.crop_id ? cropById.get(String(w.crop_id)) : undefined;
    const p = w.product_id ? productById.get(String(w.product_id)) : crop?.default_product_id ? productById.get(String(crop.default_product_id)) : undefined;
    if (!p) return null;
    const cropName = cropById.get(String(p.crop_id))?.name;
    return { productId: String(p._id), label: cropName && cropName !== p.name ? `${cropName} / ${p.name}` : p.name };
  };
  const countOf = (s: string) => counts.find((c) => c._id === s)?.n ?? 0;

  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) if (typeof v === "string" && v && k !== "msg" && k !== "err") qs.set(k, v);
  const back = `/crop-words?${qs}`;
  const linkFor = (id: unknown) => {
    const next = new URLSearchParams(qs);
    next.set("id", String(id));
    return `/crop-words?${next}`;
  };
  const selected = selectedId ? await coll.findOne({ _id: selectedId }) : null;

  return (
    <>
      <PageHeader
        title="Farmer words"
        description="Other English names for a crop (dry chillies, blackgram, beet root) and the crop they mean. Questions are translated into English before they reach the tool, so local-language words are not kept here. Only approved words are used to answer."
      />
      <Flash msg={first(sp.msg)} err={first(sp.err)} />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Tabs
          param="status"
          tabs={[
            { value: "pending", label: "Pending", count: countOf("pending") },
            { value: "check", label: "Double-check", count: checkCount },
            { value: "approved", label: "Approved", count: countOf("approved") },
            { value: "rejected", label: "Rejected", count: countOf("rejected") },
            { value: "all", label: "All" },
          ]}
        />
        <FilterSelect param="language" label="Language" options={languages.filter(Boolean).map(String).sort().map((l) => ({ value: l, label: l }))} />
        <SearchBox placeholder="Search word…" />
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div className="card h-[calc(100vh-15rem)] overflow-y-auto">
          {docs.length === 0 ? (
            <div className="p-6 text-sm text-zinc-500">Nothing here.</div>
          ) : (
            <ul className="divide-y divide-zinc-100">
              {docs.map((w) => {
                const m = meaning(w);
                return (
                  <li key={String(w._id)}>
                    <Link href={linkFor(w._id)} scroll={false} className={clsx("block px-4 py-2.5 hover:bg-zinc-50", selectedId && String(w._id) === String(selectedId) && "bg-emerald-50 hover:bg-emerald-50")}>
                      <div className="flex items-start justify-between gap-2">
                        <span className="font-medium break-words text-zinc-900">{w.word}</span>
                        <span className="shrink-0 text-xs text-zinc-400">{(w.languages ?? []).slice(0, 2).join(", ")}</span>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
                        <WordStatus status={w.status} check={w.needs_check} />
                        {w.status === "approved" && m && <span className="text-zinc-700">→ {titleCase(m.label)}</span>}
                        {w.status !== "approved" && w.suggestion?.candidates?.length ? (
                          <span className="text-zinc-500">could be: {w.suggestion.candidates.map((c) => titleCase(c.crop_name)).join(" or ")}</span>
                        ) : null}
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
          {docs.length === LIST_LIMIT && <div className="p-3 text-center text-xs text-zinc-500">Showing the first {LIST_LIMIT}. Search or filter to narrow.</div>}
        </div>

        <div className="space-y-5">
          {selected ? (
            <div className="card p-5">
              <div className="text-xs font-medium tracking-wide text-zinc-500 uppercase">Farmer word</div>
              <h2 className="mt-1 text-xl font-semibold break-words text-zinc-900">{selected.word}</h2>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-zinc-600">
                <WordStatus status={selected.status} check={selected.needs_check} />
                {selected.status === "approved" && meaning(selected) && <span>Means <b>{titleCase(meaning(selected)!.label)}</b></span>}
              </div>
              <div className="mt-3 rounded-lg bg-zinc-50 p-3 text-xs text-zinc-600">
                <div>From: {(selected.sources ?? []).join(", ") || "—"}</div>
                {selected.languages?.length ? <div>Languages: {selected.languages.join(", ")}</div> : null}
                {selected.suggestion?.reason && (
                  <div className="mt-1">
                    Why it waits: {selected.suggestion.reason}
                    {selected.suggestion.candidates?.length ? ` (${selected.suggestion.candidates.map((c) => `${titleCase(c.crop_name)} from ${(c.sources ?? []).join(", ")}`).join("; ")})` : ""}
                  </div>
                )}
                {selected.decided_by && <div className="mt-1">Decided by {selected.decided_by} · {fmtDateTime(selected.decided_at)}{selected.needs_check && " · nobody has checked this yet"}</div>}
              </div>
              {editor && (
                <form action={decideCropWordAction} className="mt-4 space-y-3">
                  <input type="hidden" name="back" value={back} />
                  <input type="hidden" name="id" value={String(selected._id)} />
                  <div>
                    <label className="label">Farmers saying this mean</label>
                    <Picker
                      kind="products"
                      name="productId"
                      placeholder="Search products…"
                      initial={meaning(selected) ? { id: meaning(selected)!.productId, label: titleCase(meaning(selected)!.label) } : null}
                    />
                  </div>
                  <input name="notes" className="input" placeholder="Note (optional)" defaultValue={selected.notes ?? ""} />
                  <div className="flex flex-wrap gap-2">
                    <SubmitButton name="status" value="approved">{selected.status === "approved" ? "Save" : "Approve"}</SubmitButton>
                    {selected.status !== "rejected" && <SubmitButton className="btn-danger" name="status" value="rejected">Reject</SubmitButton>}
                    {selected.status !== "pending" && <SubmitButton className="btn-secondary" name="status" value="pending">Back to pending</SubmitButton>}
                  </div>
                </form>
              )}
            </div>
          ) : (
            <Empty title="Pick a word on the left">See where it came from and approve or reject it.</Empty>
          )}

          {editor && (
            <form action={addCropWordAction} className="card space-y-3 p-5">
              <SectionTitle>Add a word</SectionTitle>
              <input type="hidden" name="back" value={back} />
              <div className="grid gap-3 sm:grid-cols-2">
                <input name="word" className="input" placeholder="e.g. moongphali or मूंगफली" required />
                <input name="language" className="input" placeholder="Language (optional)" />
              </div>
              <Picker kind="products" name="productId" placeholder="It means this product…" />
              <SubmitButton>Add</SubmitButton>
              <p className="text-xs text-zinc-500">{fmtNumber(countOf("approved"))} words approved so far.</p>
            </form>
          )}
        </div>
      </div>
    </>
  );
}

function WordStatus({ status, check }: { status: string; check?: boolean }) {
  if (status === "approved" && check) return <Badge tone="blue">Approved by seed</Badge>;
  return <Badge tone={status === "approved" ? "green" : status === "rejected" ? "red" : "amber"}>{titleCase(status)}</Badge>;
}

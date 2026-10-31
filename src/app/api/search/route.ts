import { NextResponse, type NextRequest } from "next/server";
import { currentUser } from "@/lib/auth";
import { stateSpellings } from "@/lib/catalog";
import { COLL, getDb, MAX_TIME_MS } from "@/lib/db";
import { escapeRegex, titleCase } from "@/lib/format";

/** Search products (with their crop) or mandis for the picker dropdowns. */
export async function GET(req: NextRequest) {
  if (!(await currentUser())) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const kind = req.nextUrl.searchParams.get("kind");
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
  const state = (req.nextUrl.searchParams.get("state") ?? "").trim();
  const db = await getDb();
  const rx = q ? { $regex: escapeRegex(q), $options: "i" } : undefined;

  if (kind === "products") {
    const crops = rx
      ? await db.collection(COLL.crops).find({ name: rx }, { projection: { _id: 1 } }).limit(200).map((c) => c._id).toArray()
      : [];
    const products = await db
      .collection(COLL.products)
      .find(rx ? { $or: [{ name: rx }, { crop_id: { $in: crops } }] } : {})
      .sort({ name: 1 })
      .limit(50)
      .maxTimeMS(MAX_TIME_MS)
      .toArray();
    const cropById = new Map(
      (await db.collection(COLL.crops).find({ _id: { $in: products.map((p) => p.crop_id) } }).toArray()).map((c) => [String(c._id), c]),
    );
    const lower = q.toLowerCase();
    products.sort((a, b) => Number(!String(a.name).includes(lower)) - Number(!String(b.name).includes(lower)));
    return NextResponse.json({
      items: products.map((p) => {
        const crop = cropById.get(String(p.crop_id));
        const isDefault = crop && String(crop.default_product_id) === String(p._id);
        return {
          id: String(p._id),
          label: titleCase(p.name) + (p.active === false ? " (off)" : ""),
          sub: `Crop: ${titleCase(crop?.name ?? "?")}${isDefault ? " · default product" : ""}${p.form === "processed" ? " · processed" : ""}`,
        };
      }),
    });
  }

  if (kind === "crops") {
    const crops = await db.collection(COLL.crops).find(rx ? { name: rx } : {}).sort({ name: 1 }).limit(40).maxTimeMS(MAX_TIME_MS).toArray();
    return NextResponse.json({
      items: crops.map((c) => ({ id: String(c._id), label: titleCase(c.name) + (c.active === false ? " (off)" : ""), sub: c.notes ?? undefined })),
    });
  }

  if (kind === "mandis") {
    const filter: Record<string, unknown> = {};
    if (rx) filter.$or = [{ name: rx }, { aliases: rx }, { district: rx }, { postcode: rx }];
    // `state` is a state code in v2; mandis store the state as text, so match every spelling.
    const spellings = state ? await stateSpellings(db, state) : [];
    if (spellings.length) filter.state = { $in: spellings };
    const docs = await db
      .collection(COLL.mandis)
      .find(filter, { projection: { name: 1, state: 1, district: 1, postcode: 1 } })
      .sort({ name: 1 })
      .limit(40)
      .maxTimeMS(MAX_TIME_MS)
      .toArray();
    return NextResponse.json({
      items: docs.map((d) => ({
        id: String(d._id),
        label: titleCase(d.name),
        sub: [titleCase(d.district), titleCase(d.state), d.postcode].filter(Boolean).join(" · "),
      })),
    });
  }

  return NextResponse.json({ error: "kind must be products, crops or mandis" }, { status: 400 });
}

import { NextResponse, type NextRequest } from "next/server";
import { currentUser } from "@/lib/auth";
import { stateSpellings } from "@/lib/catalog";
import { COLL, getDb, MAX_TIME_MS } from "@/lib/db";
import { escapeRegex, titleCase } from "@/lib/format";
import { likelyMandis, likelyProducts } from "@/lib/likely";

/** Search products (with their crop) or mandis for the picker dropdowns. */
export async function GET(req: NextRequest) {
  if (!(await currentUser())) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const kind = req.nextUrl.searchParams.get("kind");
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
  const state = (req.nextUrl.searchParams.get("state") ?? "").trim();
  const like = (req.nextUrl.searchParams.get("like") ?? "").trim();
  const district = (req.nextUrl.searchParams.get("district") ?? "").trim();
  const db = await getDb();
  const rx = q ? { $regex: escapeRegex(q), $options: "i" } : undefined;

  if (kind === "products" && like) {
    const [products, crops] = await Promise.all([
      db.collection(COLL.products).find({ active: { $ne: false } }, { projection: { name: 1, crop_id: 1, form: 1 } }).maxTimeMS(MAX_TIME_MS).toArray(),
      db.collection(COLL.crops).find({}, { projection: { name: 1 } }).maxTimeMS(MAX_TIME_MS).toArray(),
    ]);
    const cropName = new Map(crops.map((c) => [String(c._id), String(c.name)]));
    const ranked = likelyProducts(like, products.map((p) => ({ _id: p._id, name: String(p.name), cropName: cropName.get(String(p.crop_id)), form: p.form })));
    return NextResponse.json({
      items: ranked.map((p) => ({ id: String(p._id), label: titleCase(p.name), sub: `Crop: ${titleCase(p.cropName ?? "?")}${p.form === "processed" ? " · processed" : ""}` })),
    });
  }

  if (kind === "mandis" && like) {
    const spellings = state ? await stateSpellings(db, state) : [];
    const docs = await db
      .collection(COLL.mandis)
      .find(spellings.length ? { state: { $in: spellings } } : {}, { projection: { name: 1, state: 1, district: 1, source: 1, aliases: 1 } })
      .maxTimeMS(MAX_TIME_MS)
      .toArray();
    const ranked = likelyMandis(like, docs.map((d) => ({ _id: d._id, name: String(d.name), district: d.district ? String(d.district) : null, aliases: d.aliases, state: d.state, source: d.source })), district);
    return NextResponse.json({
      items: ranked.map((d) => ({
        id: String(d._id),
        label: titleCase(d.name),
        sub: [d.district ? `District: ${titleCase(d.district)}` : "No district", d.source ? `Source: ${d.source}` : null].filter(Boolean).join(" · "),
      })),
    });
  }

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
      .find(filter, { projection: { name: 1, state: 1, district: 1, postcode: 1, source: 1 } })
      .sort({ name: 1 })
      .limit(40)
      .maxTimeMS(MAX_TIME_MS)
      .toArray();
    return NextResponse.json({
      items: docs.map((d) => ({
        id: String(d._id),
        label: titleCase(d.name),
        sub: [d.district ? `District: ${titleCase(d.district)}` : "No district", titleCase(d.state), d.postcode, d.source ? `Source: ${d.source}` : null].filter(Boolean).join(" · "),
      })),
    });
  }

  return NextResponse.json({ error: "kind must be products, crops or mandis" }, { status: 400 });
}

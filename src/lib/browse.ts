import "server-only";
import { ObjectId, type Db, type Document, type Filter } from "mongodb";
import { COLL, MAX_TIME_MS } from "./db";
import { collectionDef, genericDef, type CollectionDef } from "./collections";
import { dayRange, escapeRegex, plain } from "./format";

export const PAGE_SIZE = 50;

export type BrowseParams = { q: string; page: number; filters: Record<string, string> };

export type BrowseResult = {
  def: CollectionDef;
  rows: Record<string, unknown>[];
  total: number;
  totalIsEstimate: boolean;
  filterOptions: Record<string, string[]>;
  productNames: Record<string, string>;
  mandiNames: Record<string, string>;
};

function filterValue(raw: string): unknown {
  if (raw === "true") return true;
  if (raw === "false") return false;
  return raw;
}

async function buildQuery(db: Db, def: CollectionDef, p: BrowseParams): Promise<Filter<Document>> {
  const and: Filter<Document>[] = [];
  for (const f of def.filters) {
    const v = p.filters[f.key];
    if (!v) continue;
    if (f.type === "nullable") and.push(v === "missing" ? { [f.key]: null } : { [f.key]: { $ne: null } });
    else if (f.type === "date") and.push({ [f.key]: dayRange(v) });
    else if (f.key === "active" && v === "true") and.push({ active: { $ne: false } });
    else and.push({ [f.key]: filterValue(v) });
  }

  const q = p.q.trim();
  if (q) {
    if (ObjectId.isValid(q) && q.length === 24) {
      const id = new ObjectId(q);
      and.push({ $or: [{ _id: id }, { market_commodity_id: id }, { product_id: id }, { mandi_id: id }, { crop_id: id }] });
    } else if (def.searchVia === "listings") {
      const rx = { $regex: escapeRegex(q), $options: "i" };
      const ids = await db
        .collection(COLL.listings)
        .find({ $or: [{ commodity_name: rx }, { market_name: rx }] }, { projection: { _id: 1 } })
        .limit(5000)
        .maxTimeMS(MAX_TIME_MS)
        .map((d) => d._id)
        .toArray();
      and.push({ market_commodity_id: { $in: ids } });
    } else if (def.searchFields.length) {
      const rx = { $regex: escapeRegex(q), $options: "i" };
      and.push({ $or: def.searchFields.map((f) => ({ [f]: rx })) });
    }
  }
  return and.length ? { $and: and } : {};
}

export async function browse(db: Db, name: string, p: BrowseParams): Promise<BrowseResult> {
  const coll = db.collection(name);
  let def = collectionDef(name);
  if (!def) def = genericDef(name, (await coll.find({}).limit(20).toArray()) as Record<string, unknown>[]);

  const query = await buildQuery(db, def, p);
  const empty = Object.keys(query).length === 0;

  const [rawRows, total, filterOptions] = await Promise.all([
    coll.find(query).sort(def.sort).skip((p.page - 1) * PAGE_SIZE).limit(PAGE_SIZE).maxTimeMS(MAX_TIME_MS).toArray(),
    (empty ? coll.estimatedDocumentCount() : coll.countDocuments(query, { maxTimeMS: MAX_TIME_MS })).catch(() => -1),
    Promise.all(
      def.filters
        .filter((f) => f.type === "select")
        .map(async (f) => {
          const values = await coll.distinct(f.key, {}, { maxTimeMS: 10_000 }).catch(() => []);
          return [f.key, values.filter((v) => v !== null && v !== "").map(String).sort().slice(0, 500)] as const;
        }),
    ).then(Object.fromEntries),
  ]);

  let rows = rawRows as Document[];
  // Daily prices: attach the listing (crop name, mandi, state) to each row.
  if (name === COLL.prices && rows.length) {
    const mcIds = [...new Set(rows.map((r) => String(r.market_commodity_id)))].filter((id) => ObjectId.isValid(id)).map((id) => new ObjectId(id));
    const mcs = await db.collection(COLL.listings).find({ _id: { $in: mcIds } }).toArray();
    const byId = new Map(mcs.map((m) => [String(m._id), m]));
    rows = rows.map((r) => ({ ...r, _mc: byId.get(String(r.market_commodity_id)) ?? null }));
  }

  // Show names instead of bare ids for products and mandis.
  const productIds = new Set<string>();
  const mandiIds = new Set<string>();
  for (const r of rows) {
    for (const g of [r.product_id, r._mc?.product_id, r.default_product_id]) if (g) productIds.add(String(g));
    for (const m of [r.mandi_id, r._mc?.mandi_id]) if (m) mandiIds.add(String(m));
  }
  const toIds = (s: Set<string>) => [...s].filter((x) => ObjectId.isValid(x)).map((x) => new ObjectId(x));
  const [products, mandis] = await Promise.all([
    productIds.size ? db.collection(COLL.products).find({ _id: { $in: toIds(productIds) } }, { projection: { name: 1, crop_id: 1 } }).toArray() : [],
    mandiIds.size ? db.collection(COLL.mandis).find({ _id: { $in: toIds(mandiIds) } }, { projection: { name: 1 } }).toArray() : [],
  ]);
  const crops = products.length
    ? await db.collection(COLL.crops).find({ _id: { $in: products.map((p) => p.crop_id) } }, { projection: { name: 1 } }).toArray()
    : [];
  const cropName = new Map(crops.map((c) => [String(c._id), String(c.name ?? "")]));

  return {
    def,
    rows: plain(rows),
    total: typeof total === "number" ? total : -1,
    totalIsEstimate: empty,
    filterOptions,
    productNames: Object.fromEntries(
      products.map((p) => {
        const crop = cropName.get(String(p.crop_id));
        return [String(p._id), crop && crop !== p.name ? `${crop} / ${p.name}` : String(p.name ?? "")];
      }),
    ),
    mandiNames: Object.fromEntries(mandis.map((m) => [String(m._id), String(m.name ?? "")])),
  };
}

export async function collectionSummaries(db: Db) {
  const all = await db.listCollections({}, { nameOnly: true }).toArray();
  const names = all.map((c) => c.name).filter((n) => !n.startsWith("system."));
  const counts = await Promise.all(names.map((n) => db.collection(n).estimatedDocumentCount().catch(() => -1)));
  return names.map((n, i) => ({ name: n, count: counts[i], def: collectionDef(n) }));
}

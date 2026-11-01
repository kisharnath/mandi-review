import "server-only";
import { unstable_cache } from "next/cache";
import { COLL, getDb } from "./db";
import { isoDay } from "./format";

export type GroupRow = { key: string; listings: number; withProduct: number; withMandi: number };
export type StatusCounts = Record<string, number>;

export type Statistics = {
  totals: { prices: number; listings: number; mandis: number; mandisWithLocation: number; crops: number; products: number; deletedPrices: number };
  links: { cropNames: StatusCounts; mandiNames: StatusCounts; cropWords: StatusCounts };
  byState: GroupRow[];
  bySource: GroupRow[];
  pricesPerDay: { day: string; prices: number }[];
  pricesBySource30d: { key: string; prices: number }[];
  mandisByState: { key: string; mandis: number; withLocation: number }[];
  missingMinMax: number;
  generatedAt: string;
};

const DAYS = 30;

/** Every number on the Statistics page. Heavy, so cached for 10 minutes. */
export const statistics = unstable_cache(
  async (): Promise<Statistics> => {
    const db = await getDb();
    const opts = { maxTimeMS: 55_000, allowDiskUse: true };
    const since = new Date(Date.now() - DAYS * 86_400_000);
    since.setUTCHours(0, 0, 0, 0);

    const statusOf = (coll: string) =>
      db.collection(coll).aggregate<{ _id: string; n: number }>([{ $group: { _id: "$status", n: { $sum: 1 } } }], opts).toArray()
        .then((rows) => Object.fromEntries(rows.map((r) => [r._id ?? "none", r.n])) as StatusCounts);

    const listingGroup = (field: string) =>
      db.collection(COLL.listings).aggregate<{ _id: string | null; listings: number; withProduct: number; withMandi: number }>([
        {
          $group: {
            _id: field,
            listings: { $sum: 1 },
            withProduct: { $sum: { $cond: [{ $ne: [{ $ifNull: ["$product_id", null] }, null] }, 1, 0] } },
            withMandi: { $sum: { $cond: [{ $ne: [{ $ifNull: ["$mandi_id", null] }, null] }, 1, 0] } },
          },
        },
        { $sort: { listings: -1 } },
      ], opts).toArray()
        .then((rows) => rows.map((r) => ({ key: r._id ?? "unknown", listings: r.listings, withProduct: r.withProduct, withMandi: r.withMandi })));

    const [prices, listings, mandis, mandisWithLocation, crops, products, deletedPrices, cropNames, mandiNames, cropWords,
      byState, bySource, perDay, bySource30, mandisByState, missingMinMax] = await Promise.all([
      db.collection(COLL.prices).estimatedDocumentCount(),
      db.collection(COLL.listings).estimatedDocumentCount(),
      db.collection(COLL.mandis).estimatedDocumentCount(),
      db.collection(COLL.mandis).countDocuments({ "location.coordinates.1": { $exists: true } }, opts),
      db.collection(COLL.crops).countDocuments({}, opts),
      db.collection(COLL.products).countDocuments({}, opts),
      db.collection(COLL.deletedPrices).estimatedDocumentCount(),
      statusOf(COLL.cropNames),
      statusOf(COLL.mandiNames),
      statusOf(COLL.cropWords),
      listingGroup("$state_code"),
      listingGroup("$source_system"),
      db.collection(COLL.prices).aggregate<{ _id: string; n: number }>([
        { $match: { date: { $gte: since, $lte: new Date() } } },
        { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$date" } }, n: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ], opts).toArray(),
      db.collection(COLL.prices).aggregate<{ _id: string | null; n: number }>([
        { $match: { date: { $gte: since, $lte: new Date() } } },
        { $group: { _id: "$market_commodity_id", n: { $sum: 1 } } },
        { $lookup: { from: COLL.listings, localField: "_id", foreignField: "_id", as: "mc", pipeline: [{ $project: { source_system: 1 } }] } },
        { $unwind: "$mc" },
        { $group: { _id: "$mc.source_system", n: { $sum: "$n" } } },
        { $sort: { n: -1 } },
      ], opts).toArray(),
      db.collection(COLL.mandis).aggregate<{ _id: string | null; n: number; loc: number }>([
        { $group: { _id: "$state", n: { $sum: 1 }, loc: { $sum: { $cond: [{ $gt: [{ $size: { $ifNull: ["$location.coordinates", []] } }, 1] }, 1, 0] } } } },
        { $sort: { n: -1 } },
      ], opts).toArray(),
      db.collection(COLL.prices).countDocuments({ modal_price: { $ne: null }, $or: [{ min_price: null }, { max_price: null }] }, opts),
    ]);

    // Fill days with no prices so gaps show.
    const counts = new Map(perDay.map((d) => [d._id, d.n]));
    const pricesPerDay: Statistics["pricesPerDay"] = [];
    for (let t = since.getTime(); t <= Date.now(); t += 86_400_000) {
      const day = isoDay(new Date(t));
      pricesPerDay.push({ day, prices: counts.get(day) ?? 0 });
    }

    return {
      totals: { prices, listings, mandis, mandisWithLocation, crops, products, deletedPrices },
      links: { cropNames, mandiNames, cropWords },
      byState, bySource, pricesPerDay,
      pricesBySource30d: bySource30.map((r) => ({ key: r._id ?? "unknown", prices: r.n })),
      mandisByState: mandisByState.map((r) => ({ key: r._id ?? "unknown", mandis: r.n, withLocation: r.loc })),
      missingMinMax,
      generatedAt: new Date().toISOString(),
    };
  },
  ["statistics", "v2"],
  { revalidate: 600, tags: ["prices"] },
);

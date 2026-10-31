import "server-only";
import { unstable_cache } from "next/cache";
import { COLL, getDb, MAX_TIME_MS } from "./db";
import { dayRange, isoDay } from "./format";

export type StateCoverage = {
  state: string;
  records: number;
  mandis: number;
  usualMandis: number; // mandis that reported at least once in the 7 days before
  silent: number; // of those, how many did not report on this day
  withProduct: number; // prices whose listing has an approved product (what farmers can see)
};

/** Latest price date that is not in the future. */
export const latestPriceDay = unstable_cache(
  async (): Promise<string> => {
    const db = await getDb();
    const doc = await db
      .collection(COLL.prices)
      .find({ date: { $lte: new Date() } }, { projection: { date: 1 } })
      .sort({ date: -1 })
      .limit(1)
      .maxTimeMS(MAX_TIME_MS)
      .next();
    return doc?.date ? isoDay(new Date(doc.date)) : isoDay(new Date());
  },
  ["latest-price-day"],
  { revalidate: 600 },
);

async function mandisByState(from: Date, to: Date) {
  const db = await getDb();
  return db
    .collection(COLL.prices)
    .aggregate<{ _id: string | null; records: number; withProduct: number; mandis: string[] }>(
      [
        { $match: { date: { $gte: from, $lt: to } } },
        { $group: { _id: "$market_commodity_id", n: { $sum: 1 } } },
        { $lookup: { from: COLL.listings, localField: "_id", foreignField: "_id", as: "mc", pipeline: [{ $project: { state_code: 1, state: 1, market_name: 1, mandi_id: 1, product_id: 1 } }] } },
        { $unwind: "$mc" },
        {
          $group: {
            _id: { $ifNull: ["$mc.state_code", "$mc.state"] },
            records: { $sum: "$n" },
            withProduct: { $sum: { $cond: [{ $ne: [{ $ifNull: ["$mc.product_id", null] }, null] }, "$n", 0] } },
            mandis: { $addToSet: { $ifNull: [{ $toString: "$mc.mandi_id" }, "$mc.market_name"] } },
          },
        },
      ],
      { maxTimeMS: 55_000, allowDiskUse: true },
    )
    .toArray();
}

/** Per-state coverage for one day, compared with the 7 days before it. */
export const stateCoverage = unstable_cache(
  async (day: string): Promise<StateCoverage[]> => {
    const { $gte, $lt } = dayRange(day);
    const weekStart = new Date($gte.getTime() - 7 * 86_400_000);
    const [today, week] = await Promise.all([mandisByState($gte, $lt), mandisByState(weekStart, $gte)]);
    const weekByState = new Map(week.map((w) => [w._id ?? "unknown", new Set(w.mandis)]));
    const states = new Set([...today.map((t) => t._id ?? "unknown"), ...weekByState.keys()]);
    return [...states]
      .map((state) => {
        const t = today.find((x) => (x._id ?? "unknown") === state);
        const todaySet = new Set(t?.mandis ?? []);
        const usual = weekByState.get(state) ?? new Set<string>();
        return {
          state,
          records: t?.records ?? 0,
          withProduct: t?.withProduct ?? 0,
          mandis: todaySet.size,
          usualMandis: usual.size,
          silent: [...usual].filter((m) => !todaySet.has(m)).length,
        };
      })
      .sort((a, b) => b.records - a.records || a.state.localeCompare(b.state));
  },
  ["state-coverage"],
  { revalidate: 600 },
);

/** Mandis in one state that reported in the 7 days before `day` but not on `day`. */
export async function silentMandis(state: string, day: string) {
  const db = await getDb();
  const { $gte, $lt } = dayRange(day);
  const weekStart = new Date($gte.getTime() - 7 * 86_400_000);
  const rows = await db
    .collection(COLL.prices)
    .aggregate<{ _id: string; name: string; lastDate: Date; onDay: boolean }>(
      [
        { $match: { date: { $gte: weekStart, $lt } } },
        { $group: { _id: "$market_commodity_id", last: { $max: "$date" } } },
        { $lookup: { from: COLL.listings, localField: "_id", foreignField: "_id", as: "mc", pipeline: [{ $project: { state_code: 1, state: 1, market_name: 1, mandi_id: 1, product_id: 1 } }] } },
        { $unwind: "$mc" },
        { $match: { $or: [{ "mc.state_code": state }, { "mc.state_code": null, "mc.state": state }] } },
        {
          $group: {
            _id: { $ifNull: [{ $toString: "$mc.mandi_id" }, "$mc.market_name"] },
            name: { $first: "$mc.market_name" },
            lastDate: { $max: "$last" },
          },
        },
        { $match: { lastDate: { $lt: $gte } } },
        { $sort: { lastDate: -1 } },
      ],
      { maxTimeMS: 55_000, allowDiskUse: true },
    )
    .toArray();
  return rows.map((r) => ({ id: r._id, name: r.name, lastDate: r.lastDate }));
}

export async function latestRuns(limit = 200) {
  const db = await getDb();
  return db.collection(COLL.runs).find({}).sort({ started_at: -1 }).limit(limit).maxTimeMS(MAX_TIME_MS).toArray();
}

export async function openReviewCounts() {
  const db = await getDb();
  const rows = await db
    .collection(COLL.review)
    .aggregate<{ _id: string; n: number }>([{ $match: { status: "open" } }, { $group: { _id: "$type", n: { $sum: 1 } } }], { maxTimeMS: MAX_TIME_MS })
    .toArray();
  return Object.fromEntries(rows.map((r) => [r._id, r.n])) as Record<string, number>;
}

/** state code → display name, for pages that show codes. */
export const stateNames = unstable_cache(
  async (): Promise<Record<string, string>> => {
    const db = await getDb();
    const rows = await db.collection<{ _id: string; name: string }>(COLL.states).find({}, { projection: { name: 1 } }).toArray();
    return Object.fromEntries(rows.map((r) => [r._id, r.name]));
  },
  ["state-names"],
  { revalidate: 300 },
);

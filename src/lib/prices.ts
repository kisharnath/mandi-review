import "server-only";
import { unstable_cache } from "next/cache";
import { ObjectId, type Db, type Document, type Filter } from "mongodb";
import { writeAudit } from "./audit";
import { COLL, getDb } from "./db";
import { isoDay } from "./format";
import type { SessionUser } from "./session";

/**
 * Prices that cannot be right. The same checks as the scraper's review_log.price_problems,
 * written as queries. A missing min or max alone is not a problem: several sources publish
 * only the modal price.
 */
const isNum = (f: string) => ({ $in: [{ $type: `$${f}` }, ["double", "int", "long", "decimal"]] });
const minMax = { $and: [isNum("min_price"), isNum("max_price")] };

export const PRICE_PROBLEMS = {
  zero: {
    label: "Zero or negative price",
    hint: "min, max or modal is 0 or below",
    filter: { $or: [{ min_price: { $lte: 0 } }, { max_price: { $lte: 0 } }, { modal_price: { $lte: 0 } }] },
    deleteAll: true,
  },
  min_above_max: {
    label: "Min above max",
    hint: "min price is higher than max price",
    filter: { $expr: { $and: [minMax, { $gt: ["$min_price", "$max_price"] }] } },
    deleteAll: true,
  },
  modal_outside: {
    label: "Modal outside min–max",
    hint: "modal price is not between min and max",
    filter: {
      $expr: {
        $and: [minMax, isNum("modal_price"), { $lte: ["$min_price", "$max_price"] },
          { $or: [{ $lt: ["$modal_price", "$min_price"] }, { $gt: ["$modal_price", "$max_price"] }] }],
      },
    },
    deleteAll: true,
  },
  no_price: {
    label: "No price at all",
    hint: "min, max and modal are all empty",
    filter: { modal_price: null, min_price: null, max_price: null },
    deleteAll: true,
  },
  modal_missing: {
    label: "No modal price",
    // Real prices: almost all are Meghalaya (megamb), whose modal field the scraper does not read yet.
    hint: "min and max are there but the modal is empty, almost all from Meghalaya (megamb), where the scraper does not read the modal yet. These are real prices: fix the scraper or edit them, don't delete them in bulk",
    filter: { modal_price: null, $or: [{ min_price: { $ne: null } }, { max_price: { $ne: null } }] },
    deleteAll: false,
  },
} as const satisfies Record<string, { label: string; hint: string; filter: Filter<Document>; deleteAll: boolean }>;

export type PriceProblem = keyof typeof PRICE_PROBLEMS;
export const PROBLEM_KEYS = Object.keys(PRICE_PROBLEMS) as PriceProblem[];

export function isProblem(v: string | undefined): v is PriceProblem {
  return !!v && v in PRICE_PROBLEMS;
}

export function problemFilter(problem?: PriceProblem): Filter<Document> {
  return problem ? PRICE_PROBLEMS[problem].filter : { $or: PROBLEM_KEYS.map((k) => PRICE_PROBLEMS[k].filter) };
}

/** Which checks one price fails (for the row badges). */
export function problemsOf(p: { min_price?: number | null; max_price?: number | null; modal_price?: number | null }): PriceProblem[] {
  const n = (v: unknown): v is number => typeof v === "number" && !Number.isNaN(v);
  const { min_price: lo, max_price: hi, modal_price: modal } = p;
  const out: PriceProblem[] = [];
  if ([lo, hi, modal].some((v) => n(v) && v <= 0)) out.push("zero");
  if (n(lo) && n(hi) && lo > hi) out.push("min_above_max");
  if (n(lo) && n(hi) && n(modal) && lo <= hi && (modal < lo || modal > hi)) out.push("modal_outside");
  const empty = (v: unknown) => v === null || v === undefined;
  if (empty(modal)) out.push(empty(lo) && empty(hi) ? "no_price" : "modal_missing");
  return out;
}

export type BadPriceRow = {
  _id: ObjectId;
  market_commodity_id: ObjectId;
  date: Date;
  min_price?: number | null;
  max_price?: number | null;
  modal_price?: number | null;
  arrival_quantity?: number | null;
  ingested_at?: Date;
  edited_by?: string;
  mc?: { commodity_name?: string; variety?: string | null; market_name?: string; state?: string; state_code?: string | null; source_system?: string; product_id?: ObjectId | null };
};

const LISTING_LOOKUP = {
  $lookup: {
    from: COLL.listings, localField: "market_commodity_id", foreignField: "_id", as: "mc",
    pipeline: [{ $project: { commodity_name: 1, variety: 1, market_name: 1, state: 1, state_code: 1, source_system: 1, product_id: 1 } }],
  },
};

export type BadPriceQuery = { problem?: PriceProblem; state?: string; date?: string };

function pipelineFor(q: BadPriceQuery): Document[] {
  const match: Filter<Document> = { ...problemFilter(q.problem) };
  if (q.date) {
    const start = new Date(`${q.date}T00:00:00.000Z`);
    if (!Number.isNaN(start.getTime())) match.date = { $gte: start, $lt: new Date(start.getTime() + 86_400_000) };
  }
  const stages: Document[] = [{ $match: match }, LISTING_LOOKUP, { $unwind: { path: "$mc", preserveNullAndEmptyArrays: true } }];
  if (q.state) stages.push({ $match: { $or: [{ "mc.state_code": q.state }, { "mc.state_code": null, "mc.state": q.state }] } });
  return stages;
}

/**
 * Every wrong price, in a compact form: [price id, day (YYYY-MM-DD), problem bits, state].
 *
 * Finding wrong prices means reading every price row (the checks compare fields, so no
 * index helps): seconds on a large collection. It is done once into this index, which the
 * Wrong prices page and the counts then filter in memory.
 */
export type BadPriceEntry = [id: string, day: string, mask: number, state: string];
const BIT = Object.fromEntries(PROBLEM_KEYS.map((k, i) => [k, 1 << i])) as Record<PriceProblem, number>;

export async function buildBadPriceIndex(db: Db): Promise<BadPriceEntry[]> {
  const rows = await db
    .collection(COLL.prices)
    .aggregate<BadPriceRow>(
      [
        { $match: problemFilter() },
        { $project: { date: 1, min_price: 1, max_price: 1, modal_price: 1, market_commodity_id: 1 } },
        { $lookup: { from: COLL.listings, localField: "market_commodity_id", foreignField: "_id", as: "mc", pipeline: [{ $project: { state_code: 1, state: 1 } }] } },
        { $unwind: { path: "$mc", preserveNullAndEmptyArrays: true } },
      ],
      { maxTimeMS: 55_000, allowDiskUse: true },
    )
    .toArray();
  return rows
    .map((r): BadPriceEntry => [
      String(r._id),
      isoDay(new Date(r.date)),
      problemsOf(r).reduce((m, p) => m | BIT[p], 0),
      r.mc?.state_code ?? r.mc?.state ?? "",
    ])
    .filter((e) => e[2] !== 0);
}

/** Built at most every 10 minutes and shared by all pages; deleting or editing a price clears it (tag "prices"). */
export const cachedBadPriceIndex = unstable_cache(async () => buildBadPriceIndex(await getDb()), ["bad-price-index", "v1", PROBLEM_KEYS.join(",")], {
  revalidate: 600,
  tags: ["prices"],
});

function matches(e: BadPriceEntry, q: BadPriceQuery): boolean {
  return (!q.problem || (e[2] & BIT[q.problem]) !== 0) && (!q.state || e[3] === q.state) && (!q.date || e[1] === q.date);
}

/** One page of wrong prices, newest first. Pass the cached index from a page; tests build it fresh. */
export async function listBadPrices(db: Db, q: BadPriceQuery, page: number, pageSize: number, index?: BadPriceEntry[]) {
  const all = (index ?? (await buildBadPriceIndex(db))).filter((e) => matches(e, q));
  all.sort((a, b) => (a[1] === b[1] ? (a[0] < b[0] ? -1 : 1) : a[1] < b[1] ? 1 : -1));
  const ids = all.slice((page - 1) * pageSize, page * pageSize).map((e) => new ObjectId(e[0]));
  if (!ids.length) return { rows: [] as BadPriceRow[], total: all.length };
  const rows = await db
    .collection(COLL.prices)
    .aggregate<BadPriceRow>([{ $match: { _id: { $in: ids } } }, LISTING_LOOKUP, { $unwind: { path: "$mc", preserveNullAndEmptyArrays: true } }, { $sort: { date: -1, _id: 1 } }], {
      maxTimeMS: 20_000,
    })
    .toArray();
  return { rows, total: all.length };
}

export function countsFromIndex(index: BadPriceEntry[]): Record<PriceProblem, number> {
  return Object.fromEntries(PROBLEM_KEYS.map((k) => [k, index.filter((e) => (e[2] & BIT[k]) !== 0).length])) as Record<PriceProblem, number>;
}

/** Count of prices failing each check. */
export async function badPriceCounts(db: Db): Promise<Record<PriceProblem, number>> {
  return countsFromIndex(await buildBadPriceIndex(db));
}

/** Counts for the pages, from the cached index. */
export async function cachedBadPriceCounts(): Promise<Record<PriceProblem, number>> {
  return countsFromIndex(await cachedBadPriceIndex());
}

/** Open "price looks wrong" review items for these prices are closed with the same action. */
async function closeReviewItems(db: Db, user: SessionUser, rows: BadPriceRow[], action: "deleted" | "edited") {
  const ops = rows
    .filter((r) => r.mc?.market_name && r.mc?.commodity_name)
    .map((r) => ({
      updateMany: {
        filter: {
          type: "price_invalid", status: "open",
          "details.market_name": r.mc!.market_name, "details.commodity_name": r.mc!.commodity_name, "details.date": isoDay(new Date(r.date)),
        },
        update: { $set: { status: "resolved", resolved_by: user.name, resolved_at: new Date(), resolution: { action: `price_${action}` } } },
      },
    }));
  if (!ops.length) return 0;
  const res = await db.collection(COLL.review).bulkWrite(ops, { ordered: false });
  return res.modifiedCount;
}

/** Hard cap for one "delete everything matching" request. */
export const MAX_DELETE_ALL = 10_000;

/**
 * Delete prices. Each one is first copied to <prefix>deleted_price_records (with who,
 * when and why), so a deletion can be undone by copying it back.
 */
export async function deletePrices(
  db: Db, user: SessionUser,
  target: { ids: ObjectId[] } | { all: BadPriceQuery },
  reason: string,
) {
  const prices = db.collection(COLL.prices);
  let rows: BadPriceRow[];
  if ("ids" in target) {
    if (!target.ids.length) throw new Error("Tick at least one price first.");
    rows = await prices.aggregate<BadPriceRow>([{ $match: { _id: { $in: target.ids } } }, LISTING_LOOKUP, { $unwind: { path: "$mc", preserveNullAndEmptyArrays: true } }], { maxTimeMS: 55_000 }).toArray();
    // Only prices that still fail a check can be deleted here.
    rows = rows.filter((r) => problemsOf(r).length > 0);
    if (!rows.length) throw new Error("None of the ticked prices fail a check any more; nothing was deleted.");
  } else {
    const p = target.all.problem;
    if (!p || !PRICE_PROBLEMS[p].deleteAll) throw new Error("Delete-all works on one problem at a time, and not on prices that only lack a modal.");
    rows = await prices.aggregate<BadPriceRow>([...pipelineFor(target.all), { $limit: MAX_DELETE_ALL + 1 }], { maxTimeMS: 55_000, allowDiskUse: true }).toArray();
    if (!rows.length) throw new Error("No prices match; nothing was deleted.");
    if (rows.length > MAX_DELETE_ALL) throw new Error(`More than ${MAX_DELETE_ALL} prices match. Narrow it down by state or date first.`);
  }

  const now = new Date();
  const ids = rows.map((r) => r._id);
  const originals = await prices.find<BadPriceRow>({ _id: { $in: ids } }).toArray();
  await db.collection(COLL.deletedPrices).bulkWrite(
    originals.map((doc) => ({
      replaceOne: { filter: { _id: doc._id }, replacement: { ...doc, deleted_by: user.name, deleted_at: now, delete_reason: reason || null, problems: problemsOf(doc) }, upsert: true },
    })),
    { ordered: false },
  );
  const res = await prices.deleteMany({ _id: { $in: ids } });
  const closed = await closeReviewItems(db, user, rows, "deleted");
  await writeAudit(db, user, {
    action: "price.deleted",
    summary: `Deleted ${res.deletedCount} wrong price(s)${reason ? `: ${reason}` : ""}. Copies kept in ${COLL.deletedPrices}.`,
    target: { ids, ...("all" in target ? { filter: target.all } : {}) },
    counts: { prices: res.deletedCount, review_items: closed },
  });
  return { deleted: res.deletedCount, closed };
}

export type PriceEdit = { min: number | null; max: number | null; modal: number | null };

export function validatePriceEdit(e: PriceEdit): void {
  for (const [label, v] of [["Min", e.min], ["Max", e.max], ["Modal", e.modal]] as const) {
    if (v !== null && (!Number.isFinite(v) || v <= 0)) throw new Error(`${label} price must be a number above 0, or empty.`);
  }
  if (e.modal === null) throw new Error("Modal price is needed: it is the price farmers are shown.");
  if (e.min !== null && e.max !== null) {
    if (e.min > e.max) throw new Error("Min price cannot be above max price.");
    if (e.modal < e.min || e.modal > e.max) throw new Error("Modal price must be between min and max.");
  }
}

export async function editPrice(db: Db, user: SessionUser, id: ObjectId, e: PriceEdit) {
  validatePriceEdit(e);
  const prices = db.collection(COLL.prices);
  const [row] = await prices.aggregate<BadPriceRow>([{ $match: { _id: id } }, LISTING_LOOKUP, { $unwind: { path: "$mc", preserveNullAndEmptyArrays: true } }]).toArray();
  if (!row) throw new Error("That price no longer exists.");
  const before = { min_price: row.min_price ?? null, max_price: row.max_price ?? null, modal_price: row.modal_price ?? null };
  const after = { min_price: e.min, max_price: e.max, modal_price: e.modal };
  // price_before_edit keeps the scraped values from the first edit; later edits are in the audit log.
  await prices.updateOne({ _id: id }, [
    { $set: { ...after, edited_by: user.name, edited_at: new Date(), price_before_edit: { $ifNull: ["$price_before_edit", { $literal: before }] } } },
  ]);
  const closed = await closeReviewItems(db, user, [row], "edited");
  await writeAudit(db, user, {
    action: "price.edited",
    summary: `Edited the price of ${row.mc?.commodity_name ?? "?"} at ${row.mc?.market_name ?? "?"} on ${isoDay(new Date(row.date))}`,
    target: { id }, before, after, counts: { prices: 1, review_items: closed },
  });
}

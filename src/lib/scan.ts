import type { Db, AnyBulkWriteOperation } from "mongodb";
import { COLL } from "./db";
import { listCropNames } from "./mapping";

/**
 * One-time (and repeatable) check of the data already in the database.
 * Adds review items; never changes crop groups, listings or prices.
 *
 *   unmapped_commodity   crop name with no group
 *   suspicious_mapping   crop name whose group looks unrelated ("hen" under groundnut)
 *   duplicate_alias      the same name listed in more than one group
 */
export async function scanMapping(db: Db, by = "scan") {
  const names = await listCropNames(db);
  const now = new Date();
  const ops: AnyBulkWriteOperation[] = [];

  const upsert = (key: string, type: string, title: string, details: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
    ops.push({
      updateOne: {
        filter: { key },
        update: {
          $setOnInsert: { key, type, status: "open", first_seen: now },
          $set: { title, details, last_seen: now, scanned_by: by, ...extra },
        },
        upsert: true,
      },
    });

  for (const n of names) {
    if (n.flags.includes("unmatched")) {
      upsert(`unmapped_commodity|${n.name}`, "unmapped_commodity", `Crop name not matched: ${n.name}`,
        { commodity_name: n.name }, { states: n.states, sources: n.sources, records_seen: n.listings });
    }
    if (n.flags.includes("looks_wrong")) {
      upsert(`suspicious_mapping|${n.name}`, "suspicious_mapping", `"${n.name}" is under ${n.groupName} — check`,
        { commodity_name: n.name, group_id: n.groupId, group_name: n.groupName },
        { states: n.states, sources: n.sources, records_seen: n.listings });
    }
  }

  const dupes = await db
    .collection(COLL.groups)
    .aggregate<{ _id: string; groups: { id: unknown; name: string }[] }>([
      { $unwind: "$aliases" },
      { $group: { _id: "$aliases", groups: { $addToSet: { id: "$_id", name: "$canonical_name" } } } },
      { $match: { "groups.1": { $exists: true } } },
    ])
    .toArray();
  for (const d of dupes) {
    upsert(`duplicate_alias|${d._id}`, "duplicate_alias", `"${d._id}" is listed in ${d.groups.length} crop groups`,
      { commodity_name: d._id, groups: d.groups });
  }

  if (ops.length) {
    await db.collection(COLL.review).createIndex({ key: 1 }, { unique: true, name: "key_unique" });
    await db.collection(COLL.review).bulkWrite(ops, { ordered: false });
  }
  return {
    unmapped: names.filter((n) => n.flags.includes("unmatched")).length,
    suspicious: names.filter((n) => n.flags.includes("looks_wrong")).length,
    duplicates: dupes.length,
  };
}

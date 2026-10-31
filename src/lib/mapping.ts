import "server-only";
import { ObjectId, type Db } from "mongodb";
import { writeAudit } from "./audit";
import { COLL, MAX_TIME_MS } from "./db";
import { escapeRegex, normName } from "./format";
import { isOtherScript, looksWrong, type NameFlag } from "./heuristics";
import type { SessionUser } from "./session";

/**
 * How crop names are matched today:
 *   commodity_alias_lookup  = crop groups; each has canonical_name + aliases[]
 *   markets_commodities     = one row per (source, mandi, crop name, ...) with commodity_alias_lookup_id
 *   price_records           = daily prices; also carry commodity_alias_lookup_id
 *
 * The scraper matches a crop name to a group by an EXACT alias match on every run
 * and overwrites the listing's group id. So a mapping change must update the
 * group's aliases (the source of truth) as well as the listings and prices.
 */

export type GroupDoc = {
  _id: ObjectId;
  canonical_name?: string;
  aliases?: string[];
  active?: boolean;
  crop_master_id?: unknown;
  notes?: string | null;
  updatedAt?: Date;
};

export type NameRow = {
  name: string;
  listings: number;
  states: string[];
  sources: string[];
  groupId: string | null;
  groupName: string | null;
  flags: NameFlag[];
};

/** All distinct crop names in markets_commodities with their current group and flags. */
export async function listCropNames(db: Db): Promise<NameRow[]> {
  const [rows, groups] = await Promise.all([
    db
      .collection(COLL.markets)
      .aggregate<{ _id: { name: string | null; gid: ObjectId | null }; n: number; states: string[]; sources: string[] }>(
        [
          {
            $group: {
              _id: { name: "$commodity_name", gid: "$commodity_alias_lookup_id" },
              n: { $sum: 1 },
              states: { $addToSet: "$state" },
              sources: { $addToSet: "$source_system" },
            },
          },
        ],
        { maxTimeMS: MAX_TIME_MS, allowDiskUse: true },
      )
      .toArray(),
    db.collection<GroupDoc>(COLL.groups).find({}, { projection: { canonical_name: 1, aliases: 1 } }).toArray(),
  ]);

  const groupById = new Map(groups.map((g) => [String(g._id), g]));
  const groupsPerAlias = new Map<string, number>();
  for (const g of groups) for (const a of new Set(g.aliases ?? [])) groupsPerAlias.set(a, (groupsPerAlias.get(a) ?? 0) + 1);

  // A name can appear with several group ids (or none) across listings; merge them.
  const byName = new Map<string, NameRow & { gids: Map<string, number> }>();
  for (const r of rows) {
    const name = normName(r._id.name);
    if (!name) continue;
    const row = byName.get(name) ?? {
      name, listings: 0, states: [], sources: [], groupId: null, groupName: null, flags: [], gids: new Map(),
    };
    row.listings += r.n;
    row.states = [...new Set([...row.states, ...r.states.filter(Boolean)])];
    row.sources = [...new Set([...row.sources, ...r.sources.filter(Boolean)])];
    const gid = r._id.gid ? String(r._id.gid) : "";
    row.gids.set(gid, (row.gids.get(gid) ?? 0) + r.n);
    byName.set(name, row);
  }

  return [...byName.values()]
    .map(({ gids, ...row }) => {
      const main = [...gids.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
      const group = main ? groupById.get(main) : undefined;
      const flags: NameFlag[] = [];
      if (!main || gids.has("")) flags.push("unmatched");
      if (group && looksWrong(row.name, group.canonical_name, group.aliases)) flags.push("looks_wrong");
      if (isOtherScript(row.name)) flags.push("other_script");
      if ((groupsPerAlias.get(row.name) ?? 0) > 1) flags.push("in_many_groups");
      return { ...row, groupId: main, groupName: group?.canonical_name ?? (main ? "(missing group)" : null), flags };
    })
    .sort((a, b) => b.listings - a.listings);
}

export async function listGroups(db: Db, q = "") {
  const filter = q
    ? { $or: [{ canonical_name: { $regex: escapeRegex(q), $options: "i" } }, { aliases: { $regex: escapeRegex(q), $options: "i" } }] }
    : {};
  const [groups, counts] = await Promise.all([
    db.collection<GroupDoc>(COLL.groups).find(filter).sort({ canonical_name: 1 }).limit(1000).toArray(),
    db
      .collection(COLL.markets)
      .aggregate<{ _id: ObjectId; n: number; names: string[] }>(
        [{ $group: { _id: "$commodity_alias_lookup_id", n: { $sum: 1 }, names: { $addToSet: "$commodity_name" } } }],
        { maxTimeMS: MAX_TIME_MS },
      )
      .toArray(),
  ]);
  const countById = new Map(counts.map((c) => [String(c._id), c]));
  return groups.map((g) => ({
    id: String(g._id),
    name: g.canonical_name ?? "(no name)",
    aliases: g.aliases ?? [],
    active: g.active !== false,
    listings: countById.get(String(g._id))?.n ?? 0,
    namesInUse: (countById.get(String(g._id))?.names ?? []).filter(Boolean),
    updatedAt: g.updatedAt ?? null,
  }));
}

async function listingIdsFor(db: Db, name: string): Promise<ObjectId[]> {
  // Names are stored lower-case by the scraper; match case-insensitively to be safe.
  return db
    .collection(COLL.markets)
    .distinct("_id", { commodity_name: { $regex: `^${escapeRegex(name)}$`, $options: "i" } }) as Promise<ObjectId[]>;
}

async function groupsHolding(db: Db, name: string) {
  return db.collection<GroupDoc>(COLL.groups).find({ aliases: name }, { projection: { canonical_name: 1 } }).toArray();
}

/** Match a crop name to a group, everywhere it is used. */
export async function assignName(db: Db, user: SessionUser, rawName: string, groupId: ObjectId) {
  const name = normName(rawName);
  if (!name) throw new Error("Crop name is empty.");
  const groups = db.collection<GroupDoc>(COLL.groups);
  const target = await groups.findOne({ _id: groupId });
  if (!target) throw new Error("That crop group no longer exists.");

  const before = await groupsHolding(db, name);
  const now = new Date();
  // Only one group may hold the name, or the scraper's exact match is ambiguous.
  await groups.updateMany({ aliases: name, _id: { $ne: groupId } }, { $pull: { aliases: name }, $set: { updatedAt: now } });
  await groups.updateOne({ _id: groupId }, { $addToSet: { aliases: name }, $set: { updatedAt: now } });

  const ids = await listingIdsFor(db, name);
  const listings = await db.collection(COLL.markets).updateMany({ _id: { $in: ids } }, { $set: { commodity_alias_lookup_id: groupId } });
  const prices = await db
    .collection(COLL.prices)
    .updateMany({ market_commodity_id: { $in: ids } }, { $set: { commodity_alias_lookup_id: groupId } });

  await closeReviewItems(db, user, [`unmapped_commodity|${name}`, `suspicious_mapping|${name}`], {
    action: "mapped", group_id: groupId, group_name: target.canonical_name,
  });

  await writeAudit(db, user, {
    action: "crop_name.assign",
    summary: `Matched "${name}" to ${target.canonical_name}`,
    target: { name, group_id: groupId },
    before: before.map((g) => ({ group_id: g._id, group_name: g.canonical_name })),
    after: { group_id: groupId, group_name: target.canonical_name },
    counts: { listings: listings.modifiedCount, prices: prices.modifiedCount },
  });
  return { listings: listings.modifiedCount, prices: prices.modifiedCount };
}

/** Remove a crop name from every group. Its prices stop showing until it is matched again. */
export async function unassignName(db: Db, user: SessionUser, rawName: string) {
  const name = normName(rawName);
  const before = await groupsHolding(db, name);
  await db.collection<GroupDoc>(COLL.groups).updateMany({ aliases: name }, { $pull: { aliases: name }, $set: { updatedAt: new Date() } });
  const ids = await listingIdsFor(db, name);
  const listings = await db.collection(COLL.markets).updateMany({ _id: { $in: ids } }, { $set: { commodity_alias_lookup_id: null } });
  const prices = await db
    .collection(COLL.prices)
    .updateMany({ market_commodity_id: { $in: ids } }, { $set: { commodity_alias_lookup_id: null } });
  await writeAudit(db, user, {
    action: "crop_name.unassign",
    summary: `Removed the match for "${name}"`,
    target: { name },
    before: before.map((g) => ({ group_id: g._id, group_name: g.canonical_name })),
    counts: { listings: listings.modifiedCount, prices: prices.modifiedCount },
  });
}

export async function createGroup(db: Db, user: SessionUser, canonicalName: string, notes?: string) {
  const canonical = normName(canonicalName);
  if (!canonical) throw new Error("Give the crop group a name.");
  const groups = db.collection(COLL.groups);
  const clash = await groups.findOne({ canonical_name: { $regex: `^${escapeRegex(canonical)}$`, $options: "i" } });
  if (clash) throw new Error(`A crop group called "${clash.canonical_name}" already exists.`);
  const now = new Date();
  const doc = {
    canonical_name: canonical,
    aliases: [] as string[],
    active: true,
    confidence: 1,
    crop_master_id: null,
    language_variants: [],
    notes: notes?.trim() || null,
    source_tags: ["review_app"],
    createdAt: now,
    updatedAt: now,
  };
  const res = await groups.insertOne(doc);
  await writeAudit(db, user, {
    action: "crop_group.create",
    summary: `Created crop group ${canonical}`,
    target: { group_id: res.insertedId },
    after: doc,
  });
  return res.insertedId;
}

export async function renameGroup(db: Db, user: SessionUser, groupId: ObjectId, canonicalName: string, notes?: string) {
  const canonical = normName(canonicalName);
  if (!canonical) throw new Error("Give the crop group a name.");
  const groups = db.collection<GroupDoc>(COLL.groups);
  const before = await groups.findOne({ _id: groupId });
  if (!before) throw new Error("That crop group no longer exists.");
  await groups.updateOne({ _id: groupId }, { $set: { canonical_name: canonical, notes: notes?.trim() || null, updatedAt: new Date() } });
  await writeAudit(db, user, {
    action: "crop_group.rename",
    summary: `Renamed crop group ${before.canonical_name} to ${canonical}`,
    target: { group_id: groupId },
    before: { canonical_name: before.canonical_name, notes: before.notes ?? null },
    after: { canonical_name: canonical, notes: notes?.trim() || null },
  });
}

export async function setGroupActive(db: Db, user: SessionUser, groupId: ObjectId, active: boolean) {
  const groups = db.collection<GroupDoc>(COLL.groups);
  const before = await groups.findOne({ _id: groupId });
  if (!before) throw new Error("That crop group no longer exists.");
  await groups.updateOne({ _id: groupId }, { $set: { active, updatedAt: new Date() } });
  await writeAudit(db, user, {
    action: active ? "crop_group.activate" : "crop_group.deactivate",
    summary: `${active ? "Turned on" : "Turned off"} crop group ${before.canonical_name}`,
    target: { group_id: groupId },
  });
}

export async function closeReviewItems(
  db: Db,
  user: SessionUser,
  keys: string[],
  resolution: Record<string, unknown>,
) {
  await db.collection(COLL.review).updateMany(
    { key: { $in: keys }, status: "open" },
    { $set: { status: "resolved", resolution, resolved_by: user.name, resolved_at: new Date() } },
  );
}

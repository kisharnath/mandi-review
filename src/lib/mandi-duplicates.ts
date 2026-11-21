import "server-only";
import type { Db, ObjectId } from "mongodb";
import { writeAudit } from "./audit";
import type { MandiNameDoc, StateDoc } from "./catalog";
import { COLL, MAX_TIME_MS } from "./db";
import { normName } from "./format";
import { mandiKey } from "./heuristics";
import { districtsCompatible, rankMandis } from "./mandi-dup-rules";
import type { SessionUser } from "./session";

export type DupMember = {
  _id: ObjectId;
  name: string;
  state: string;
  district: string | null;
  postcode: string | null;
  location: unknown;
  source: string | null;
  /** Mandi names (per source) that are linked to this mandi. */
  links: Pick<MandiNameDoc, "_id" | "raw_name" | "source" | "status" | "listings">[];
  listings: number;
};

export type DupGroup = {
  key: string;
  stateCode: string;
  /** Best one to keep first. */
  members: DupMember[];
  /** No two copies name different districts, so they can be merged without a person looking. */
  safe: boolean;
  /** Copies that have names linked to them. More than one means farmers' prices are split. */
  linkedCopies: number;
  /** Pending names with the same cleaned name that are not linked to anything yet. */
  waiting: Pick<MandiNameDoc, "_id" | "raw_name" | "source" | "listings">[];
};

/** spelling → state code, from the states collection. */
async function spellingMap(db: Db): Promise<{ toCode: (spelling: unknown) => string; spellingsOf: (code: string) => string[] }> {
  const states = await db.collection<StateDoc>(COLL.states).find({}).toArray();
  const map = new Map<string, string>();
  for (const s of states) for (const sp of [s.name, ...(s.spellings ?? [])]) map.set(normName(sp), String(s._id));
  return {
    toCode: (spelling) => map.get(normName(String(spelling ?? ""))) ?? `?${normName(String(spelling ?? ""))}`,
    spellingsOf: (code) => {
      const s = states.find((x) => String(x._id) === code);
      return s ? [...new Set([s.name, ...(s.spellings ?? [])])] : [];
    },
  };
}

const MANDI_FIELDS = { name: 1, state: 1, district: 1, postcode: 1, location: 1, source: 1 } as const;

/** Every set of mandis in one state whose names are the same once spelling noise is removed. */
export async function findDuplicateGroups(db: Db, opts: { state?: string } = {}): Promise<DupGroup[]> {
  const { toCode, spellingsOf } = await spellingMap(db);
  const filter = opts.state ? { state: { $in: spellingsOf(opts.state) } } : {};
  const mandis = await db.collection(COLL.mandis).find(filter, { projection: MANDI_FIELDS }).maxTimeMS(MAX_TIME_MS).toArray();

  const buckets = new Map<string, typeof mandis>();
  for (const m of mandis) {
    const k = mandiKey(String(m.name ?? ""));
    if (k.length < 3) continue;
    const id = `${toCode(m.state)}|${k}`;
    buckets.set(id, [...(buckets.get(id) ?? []), m]);
  }
  const dupes = [...buckets.entries()].filter(([, v]) => v.length > 1);
  if (!dupes.length) return [];

  const ids = dupes.flatMap(([, v]) => v.map((m) => m._id));
  const codes = [...new Set(dupes.map(([id]) => id.split("|")[0]).filter((c) => !c.startsWith("?")))];
  const names = db.collection<MandiNameDoc>(COLL.mandiNames);
  const [linked, pending] = await Promise.all([
    names.find({ mandi_id: { $in: ids } }, { projection: { raw_name: 1, source: 1, status: 1, listings: 1, mandi_id: 1 } }).maxTimeMS(MAX_TIME_MS).toArray(),
    names.find({ status: "pending", state_code: { $in: codes } }, { projection: { raw_name: 1, source: 1, listings: 1, state_code: 1 } }).maxTimeMS(MAX_TIME_MS).toArray(),
  ]);
  const linksOf = new Map<string, DupMember["links"]>();
  for (const l of linked) linksOf.set(String(l.mandi_id), [...(linksOf.get(String(l.mandi_id)) ?? []), l]);

  const groups: DupGroup[] = dupes.map(([id, rows]) => {
    const [stateCode, key] = [id.split("|")[0], id.slice(id.indexOf("|") + 1)];
    const members: DupMember[] = rows.map((m) => {
      const links = (linksOf.get(String(m._id)) ?? []).sort((a, b) => (b.listings ?? 0) - (a.listings ?? 0));
      return {
        _id: m._id,
        name: String(m.name ?? ""),
        state: String(m.state ?? ""),
        district: m.district ? String(m.district) : null,
        postcode: m.postcode ? String(m.postcode) : null,
        location: m.location ?? null,
        source: m.source ? String(m.source) : null,
        links,
        listings: links.reduce((n, l) => n + (l.listings ?? 0), 0),
      };
    });
    const ranked = rankMandis(members);
    return {
      key,
      stateCode,
      members: ranked,
      safe: districtsCompatible(ranked),
      linkedCopies: ranked.filter((m) => m.links.length > 0).length,
      waiting: pending.filter((p) => p.state_code === stateCode && mandiKey(p.raw_name) === key),
    };
  });
  // Most affected first: most copies carrying names, then most listings involved.
  groups.sort((a, b) => b.linkedCopies - a.linkedCopies || sumListings(b) - sumListings(a) || a.key.localeCompare(b.key));
  return groups;
}

export const sumListings = (g: DupGroup) => g.members.reduce((n, m) => n + m.listings, 0);

/**
 * Point every mandi name (and its listings) that is linked to a same-named copy at `intoId`.
 * available_mandi is not touched: it is shared with v1, so copies are never deleted here.
 */
export async function mergeDuplicatesInto(db: Db, user: SessionUser, intoId: ObjectId, opts: { auto?: boolean } = {}) {
  const mandis = db.collection(COLL.mandis);
  const into = await mandis.findOne({ _id: intoId }, { projection: MANDI_FIELDS });
  if (!into) throw new Error("That mandi no longer exists.");
  const { toCode, spellingsOf } = await spellingMap(db);
  const code = toCode(into.state);
  const key = mandiKey(String(into.name ?? ""));
  if (key.length < 3) throw new Error("That mandi name is too short to match copies safely.");
  const pool = await mandis
    .find(code.startsWith("?") ? { state: into.state } : { state: { $in: spellingsOf(code) } }, { projection: { name: 1 } })
    .maxTimeMS(MAX_TIME_MS)
    .toArray();
  const copies = pool.filter((m) => String(m._id) !== String(intoId) && mandiKey(String(m.name ?? "")) === key);
  if (!copies.length) throw new Error("No other mandi has the same name in this state.");

  const names = db.collection(COLL.mandiNames);
  const now = new Date();
  let nameCount = 0;
  let listingCount = 0;
  const moved: { from: ObjectId; names: number; listings: number }[] = [];
  for (const c of copies) {
    const n = await names.updateMany(
      { mandi_id: c._id },
      { $set: { mandi_id: intoId, decided_by: user.name, decided_at: now, ...(opts.auto ? { needs_check: true } : {}) } },
    );
    await names.updateMany({ "suggestion.mandi_id": c._id }, { $set: { "suggestion.mandi_id": intoId } });
    const l = await db.collection(COLL.listings).updateMany({ mandi_id: c._id }, { $set: { mandi_id: intoId } });
    nameCount += n.modifiedCount;
    listingCount += l.modifiedCount;
    moved.push({ from: c._id, names: n.modifiedCount, listings: l.modifiedCount });
  }
  await writeAudit(db, user, {
    action: opts.auto ? "mandi_duplicate.auto_merge" : "mandi_duplicate.merge",
    summary: `Moved ${nameCount} mandi name(s) from ${copies.length} same-named mandi(s) to "${into.name}" (${into.state})`,
    target: { mandi_id: intoId, state_code: code, key },
    after: { moved },
    counts: { names: nameCount, listings: listingCount },
  });
  return { names: nameCount, listings: listingCount, copies: copies.length };
}

/** Merge every safe group (no district conflict) that has names on more than one copy. */
export async function autoMergeSafeDuplicates(db: Db, user: SessionUser, state?: string) {
  const groups = (await findDuplicateGroups(db, { state })).filter((g) => g.safe && g.linkedCopies > 1);
  let names = 0;
  let listings = 0;
  for (const g of groups) {
    const r = await mergeDuplicatesInto(db, user, g.members[0]._id, { auto: true });
    names += r.names;
    listings += r.listings;
  }
  return { groups: groups.length, names, listings };
}

/** Sum of linked-name listings per mandi, to pick the better copy of a duplicate. */
export async function linkedListings(db: Db, ids: ObjectId[]): Promise<Map<string, number>> {
  if (!ids.length) return new Map();
  const rows = await db
    .collection(COLL.mandiNames)
    .aggregate<{ _id: ObjectId; n: number }>([{ $match: { mandi_id: { $in: ids } } }, { $group: { _id: "$mandi_id", n: { $sum: { $ifNull: ["$listings", 0] } } } }], { maxTimeMS: MAX_TIME_MS })
    .toArray();
  return new Map(rows.map((r) => [String(r._id), r.n]));
}

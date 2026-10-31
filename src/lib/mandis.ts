import "server-only";
import { ObjectId, type Db } from "mongodb";
import { writeAudit } from "./audit";
import { COLL } from "./db";
import { normName } from "./format";
import type { SessionUser } from "./session";

/**
 * available_mandi keeps its existing schema. The website only creates mandis with
 * the fields the collection already uses, and edits district / postcode / location.
 * Mandi NAMES are linked to mandis through mandi_names (see catalog.ts), never by
 * adding aliases here.
 */
export async function createMandi(
  db: Db,
  user: SessionUser,
  input: { name: string; state: string; district?: string; postcode?: string; lat?: number; lon?: number },
) {
  const name = normName(input.name);
  const state = normName(input.state);
  if (!name || !state) throw new Error("Mandi name and state are required.");
  const now = new Date();
  const doc: Record<string, unknown> = {
    name,
    state,
    district: input.district?.trim() || null,
    postcode: input.postcode?.trim() || null,
    aliases: [],
    source: "review_app",
    createdAt: now,
    updatedAt: now,
  };
  if (input.lat !== undefined && input.lon !== undefined && !Number.isNaN(input.lat) && !Number.isNaN(input.lon)) {
    doc.location = { type: "Point", coordinates: [input.lon, input.lat] };
  }
  const res = await db.collection(COLL.mandis).insertOne(doc);
  await writeAudit(db, user, { action: "mandi.create", summary: `Created mandi ${name} (${state})`, target: { mandi_id: res.insertedId }, after: doc });
  return res.insertedId;
}

export async function updateMandi(
  db: Db,
  user: SessionUser,
  mandiId: ObjectId,
  input: { district?: string; postcode?: string; lat?: number; lon?: number },
) {
  const mandis = db.collection(COLL.mandis);
  const before = await mandis.findOne({ _id: mandiId });
  if (!before) throw new Error("That mandi no longer exists.");
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (input.district !== undefined) set.district = input.district.trim() || null;
  if (input.postcode !== undefined) set.postcode = input.postcode.trim() || null;
  if (input.lat !== undefined && input.lon !== undefined && !Number.isNaN(input.lat) && !Number.isNaN(input.lon)) {
    set.location = { type: "Point", coordinates: [input.lon, input.lat] };
  }
  await mandis.updateOne({ _id: mandiId }, { $set: set });
  await writeAudit(db, user, {
    action: "mandi.update",
    summary: `Updated mandi ${before.name}`,
    target: { mandi_id: mandiId },
    before: { district: before.district, postcode: before.postcode, location: before.location },
    after: set,
  });
}

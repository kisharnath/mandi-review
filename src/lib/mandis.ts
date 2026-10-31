import "server-only";
import { ObjectId, type Db } from "mongodb";
import { writeAudit } from "./audit";
import { COLL } from "./db";
import { escapeRegex, normName } from "./format";
import { closeReviewItems } from "./mapping";
import type { SessionUser } from "./session";

/**
 * A mandi name the scraper could not find in available_mandi is fixed by adding
 * the name to an existing mandi's aliases (the scraper matches aliases exactly),
 * then pointing the affected listings at that mandi.
 */
export async function linkMandiName(db: Db, user: SessionUser, rawName: string, state: string, mandiId: ObjectId) {
  const name = normName(rawName);
  const mandis = db.collection(COLL.mandis);
  const mandi = await mandis.findOne({ _id: mandiId });
  if (!mandi) throw new Error("That mandi no longer exists.");

  if (normName(mandi.name) !== name) {
    await mandis.updateOne({ _id: mandiId }, { $addToSet: { aliases: name }, $set: { updatedAt: new Date() } });
  }
  const listingFilter = {
    market_name: { $regex: `^${escapeRegex(name)}$`, $options: "i" },
    ...(state ? { state: { $regex: `^${escapeRegex(state)}$`, $options: "i" } } : {}),
  };
  const listings = await db.collection(COLL.markets).updateMany(listingFilter, { $set: { market_id: mandiId } });

  await closeReviewItems(db, user, [`unknown_market|${normName(state)}|${name}`], {
    action: "linked", mandi_id: mandiId, mandi_name: mandi.name,
  });
  await writeAudit(db, user, {
    action: "mandi_name.link",
    summary: `Linked mandi name "${name}" (${state || "any state"}) to ${mandi.name}`,
    target: { name, state, mandi_id: mandiId },
    counts: { listings: listings.modifiedCount },
  });
  return { listings: listings.modifiedCount };
}

export async function createMandi(
  db: Db,
  user: SessionUser,
  input: { name: string; state: string; district?: string; postcode?: string; lat?: number; lon?: number },
) {
  const name = normName(input.name);
  const state = normName(input.state);
  if (!name || !state) throw new Error("Mandi name and state are required.");
  const doc: Record<string, unknown> = {
    name,
    state,
    district: input.district?.trim() || null,
    postcode: input.postcode?.trim() || null,
    aliases: [name],
    source: "review_app",
    createdAt: new Date(),
    updatedAt: new Date(),
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

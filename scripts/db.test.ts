/**
 * Integration test for every change the website makes, against a THROWAWAY database.
 *
 *   TEST_MONGODB_URI=mongodb://127.0.0.1:27017 npm run test:db
 *
 * It creates and drops its own database; never point it at production.
 */
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { MongoClient, ObjectId, type Db } from "mongodb";
import { COLL } from "../src/lib/db";
import { assignName, createGroup, listCropNames, unassignName } from "../src/lib/mapping";
import { linkMandiName } from "../src/lib/mandis";
import { scanMapping } from "../src/lib/scan";

const uri = process.env.TEST_MONGODB_URI;
if (!uri) throw new Error("Set TEST_MONGODB_URI to a throwaway MongoDB");
const user = { name: "tester", role: "admin" as const };
let client: MongoClient;
let db: Db;

const ids = {
  groundnut: new ObjectId(), paddy: new ObjectId(), cattle: new ObjectId(),
  mcHen: new ObjectId(), mcPaddyA: new ObjectId(), mcPaddyB: new ObjectId(), mcRice: new ObjectId(), mcSona: new ObjectId(),
  pendurthi: new ObjectId(),
};

before(async () => {
  client = await new MongoClient(uri).connect();
  db = client.db(`mandi_review_test_${Date.now()}`);
  await db.collection(COLL.groups).insertMany([
    { _id: ids.groundnut, canonical_name: "groundnut", aliases: ["groundnut", "hen"], active: true },
    { _id: ids.paddy, canonical_name: "paddy", aliases: ["paddy", "paddy(common)", "rice"], active: true },
    { _id: ids.cattle, canonical_name: "cattle", aliases: ["cattle", "rice"], active: true },
  ]);
  await db.collection(COLL.markets).insertMany([
    { _id: ids.mcHen, commodity_name: "hen", state: "maharashtra", market_name: "pune", source_system: "agmarknet", commodity_alias_lookup_id: ids.groundnut },
    { _id: ids.mcPaddyA, commodity_name: "paddy(common)", state: "andhra pradesh", market_name: "pendurthi apmc", source_system: "agmarknet", commodity_alias_lookup_id: ids.paddy },
    { _id: ids.mcPaddyB, commodity_name: "paddy(common)", state: "andhra pradesh", market_name: "pendurti", source_system: "agmarknet", commodity_alias_lookup_id: ids.paddy, market_id: null },
    { _id: ids.mcRice, commodity_name: "rice", state: "andhra pradesh", market_name: "kurnool", source_system: "agmarknet", commodity_alias_lookup_id: ids.paddy },
    { _id: ids.mcSona, commodity_name: "paddy-sona", state: "andhra pradesh", market_name: "kurnool", source_system: "ap", commodity_alias_lookup_id: null },
  ]);
  await db.collection(COLL.prices).insertMany([
    { market_commodity_id: ids.mcHen, commodity_alias_lookup_id: ids.groundnut, date: new Date("2026-10-28"), modal_price: 400 },
    { market_commodity_id: ids.mcSona, commodity_alias_lookup_id: null, date: new Date("2026-10-28"), modal_price: 2600 },
    { market_commodity_id: ids.mcSona, commodity_alias_lookup_id: null, date: new Date("2026-10-29"), modal_price: 2610 },
  ]);
  await db.collection(COLL.mandis).insertOne({ _id: ids.pendurthi, name: "pendurthi apmc", state: "andhra pradesh", aliases: [] });
});

after(async () => {
  await db?.dropDatabase();
  await client?.close();
});

test("lists names with the right flags", async () => {
  const rows = await listCropNames(db);
  const by = Object.fromEntries(rows.map((r) => [r.name, r]));
  assert.deepEqual(by["hen"].flags, ["looks_wrong"]);
  assert.deepEqual(by["paddy-sona"].flags, ["unmatched"]);
  assert.ok(by["rice"].flags.includes("in_many_groups"));
  assert.deepEqual(by["paddy(common)"].flags, []);
});

test("scan adds review items and changes nothing else", async () => {
  const before = await db.collection(COLL.groups).find().sort({ _id: 1 }).toArray();
  const res = await scanMapping(db, "test");
  assert.equal(res.unmapped, 1);
  assert.equal(res.duplicates, 1);
  const keys = (await db.collection(COLL.review).find().toArray()).map((d) => d.key).sort();
  assert.ok(keys.includes("unmapped_commodity|paddy-sona"));
  assert.ok(keys.includes("suspicious_mapping|hen"));
  assert.ok(keys.includes("duplicate_alias|rice"));
  assert.deepEqual(await db.collection(COLL.groups).find().sort({ _id: 1 }).toArray(), before);
  // Running it again does not duplicate items.
  const count = await db.collection(COLL.review).countDocuments();
  await scanMapping(db, "test");
  assert.equal(await db.collection(COLL.review).countDocuments(), count);
});

test("assigning a name updates the group, listings and prices, and closes its review item", async () => {
  const res = await assignName(db, user, "Paddy-Sona ", ids.paddy);
  assert.deepEqual(res, { listings: 1, prices: 2 });
  const paddy = await db.collection(COLL.groups).findOne({ _id: ids.paddy });
  assert.ok(paddy!.aliases.includes("paddy-sona"));
  assert.equal(await db.collection(COLL.prices).countDocuments({ commodity_alias_lookup_id: ids.paddy }), 2);
  const item = await db.collection(COLL.review).findOne({ key: "unmapped_commodity|paddy-sona" });
  assert.equal(item!.status, "resolved");
  assert.equal(item!.resolved_by, "tester");
  assert.equal(await db.collection(COLL.audit).countDocuments({ action: "crop_name.assign" }), 1);
});

test("assigning a name in several groups leaves it in exactly one", async () => {
  await assignName(db, user, "rice", ids.paddy);
  const holders = await db.collection(COLL.groups).find({ aliases: "rice" }).toArray();
  assert.deepEqual(holders.map((h) => String(h._id)), [String(ids.paddy)]);
});

test("moving a wrongly matched name to a new group", async () => {
  const cattle = await createGroup(db, user, "Poultry");
  await assignName(db, user, "hen", cattle);
  const groundnut = await db.collection(COLL.groups).findOne({ _id: ids.groundnut });
  assert.ok(!groundnut!.aliases.includes("hen"));
  assert.equal((await db.collection(COLL.markets).findOne({ _id: ids.mcHen }))!.commodity_alias_lookup_id.toString(), cattle.toString());
  assert.equal((await db.collection(COLL.prices).findOne({ market_commodity_id: ids.mcHen }))!.commodity_alias_lookup_id.toString(), cattle.toString());
  await assert.rejects(createGroup(db, user, "poultry"), /already exists/);
});

test("removing a match hides the name everywhere", async () => {
  await unassignName(db, user, "hen");
  assert.equal(await db.collection(COLL.groups).countDocuments({ aliases: "hen" }), 0);
  assert.equal((await db.collection(COLL.markets).findOne({ _id: ids.mcHen }))!.commodity_alias_lookup_id, null);
});

test("linking an unknown mandi name adds an alias and points listings at it", async () => {
  await db.collection(COLL.review).insertOne({ key: "unknown_market|andhra pradesh|pendurti", type: "unknown_market", status: "open" });
  const res = await linkMandiName(db, user, "Pendurti", "andhra pradesh", ids.pendurthi);
  assert.equal(res.listings, 1);
  const mandi = await db.collection(COLL.mandis).findOne({ _id: ids.pendurthi });
  assert.deepEqual(mandi!.aliases, ["pendurti"]);
  assert.equal(String((await db.collection(COLL.markets).findOne({ _id: ids.mcPaddyB }))!.market_id), String(ids.pendurthi));
  assert.equal((await db.collection(COLL.review).findOne({ key: "unknown_market|andhra pradesh|pendurti" }))!.status, "resolved");
});

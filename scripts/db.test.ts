/**
 * Integration test for every change the website makes, against a THROWAWAY database.
 *
 *   TEST_MONGODB_URI=mongodb://127.0.0.1:27017 npm run test:db
 *
 * It creates and drops its own database; never point it at a real one.
 */
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { MongoClient, ObjectId, type Db } from "mongodb";
import {
  addStateSpelling, addVarietyLink, createCrop, createProduct, decideCropName, decideMandiName, linkCounts, updateCrop,
} from "../src/lib/catalog";
import { COLL } from "../src/lib/db";
import { createMandi } from "../src/lib/mandis";

const uri = process.env.TEST_MONGODB_URI;
if (!uri) throw new Error("Set TEST_MONGODB_URI to a throwaway MongoDB");
const user = { name: "tester", role: "admin" as const };
let client: MongoClient;
let db: Db;

const ids = {
  paddyCrop: new ObjectId(), paddy: new ObjectId(), groundnutCrop: new ObjectId(), groundnut: new ObjectId(),
  cnPaddy: new ObjectId(), cnHen: new ObjectId(), cnSona: new ObjectId(),
  mnPendurti: new ObjectId(), pendurthi: new ObjectId(),
  l1: new ObjectId(), l2: new ObjectId(), l3: new ObjectId(), l4: new ObjectId(), l5: new ObjectId(),
};

before(async () => {
  client = await new MongoClient(uri).connect();
  db = client.db(`mandi_review_test_${Date.now()}`);
  await db.collection(COLL.states).insertOne({ _id: "andhra-pradesh" as unknown as ObjectId, name: "andhra pradesh", spellings: ["andhra pradesh"] });
  await db.collection(COLL.crops).insertMany([
    { _id: ids.paddyCrop, name: "paddy", default_product_id: ids.paddy, active: true },
    { _id: ids.groundnutCrop, name: "groundnut", default_product_id: ids.groundnut, active: true },
  ]);
  await db.collection(COLL.products).insertMany([
    { _id: ids.paddy, crop_id: ids.paddyCrop, name: "paddy", form: "raw", active: true },
    { _id: ids.groundnut, crop_id: ids.groundnutCrop, name: "groundnut", form: "raw", active: true },
  ]);
  await db.collection(COLL.cropNames).insertMany([
    { _id: ids.cnPaddy, source: "agmarknet", raw_name: "paddy(common)", raw_variety: "*", product_id: ids.paddy, status: "approved", needs_check: true, decided_by: "migration" },
    { _id: ids.cnHen, source: "agmarknet", raw_name: "hen", raw_variety: "*", product_id: null, status: "pending", suggestion: { product_id: ids.groundnut, reason: "looks wrong" } },
    { _id: ids.cnSona, source: "ap", raw_name: "paddy-sona", raw_variety: "*", product_id: null, status: "pending" },
  ]);
  await db.collection(COLL.mandis).insertOne({ _id: ids.pendurthi, name: "pendurthi apmc", state: "andhra pradesh", aliases: [] });
  await db.collection(COLL.mandiNames).insertOne({ _id: ids.mnPendurti, source: "agmarknet", state_code: "andhra-pradesh", raw_name: "pendurti", mandi_id: null, status: "pending" });
  await db.collection(COLL.listings).insertMany([
    { _id: ids.l1, source_system: "agmarknet", state: "andhra pradesh", state_code: "andhra-pradesh", market_name: "pendurti", commodity_name: "paddy(common)", variety: "paddy", product_id: ids.paddy, mandi_id: null },
    { _id: ids.l2, source_system: "agmarknet", state: "andhra pradesh", state_code: "andhra-pradesh", market_name: "pune", commodity_name: "hen", variety: null, product_id: null, mandi_id: null },
    { _id: ids.l3, source_system: "ap", state: "andhra pradesh", state_code: "andhra-pradesh", market_name: "kurnool", commodity_name: "paddy-sona", variety: "sona", product_id: null, mandi_id: null },
    { _id: ids.l4, source_system: "ap", state: "andhra pradesh", state_code: "andhra-pradesh", market_name: "kurnool", commodity_name: "paddy-sona", variety: "basmati", product_id: null, mandi_id: null },
    { _id: ids.l5, source_system: "agmarknet", state: "a.p.", state_code: null, market_name: "x", commodity_name: "paddy(common)", variety: "paddy", product_id: null, mandi_id: null },
  ]);
  await db.collection(COLL.prices).insertOne({ market_commodity_id: ids.l3, date: new Date("2026-10-28"), modal_price: 2600 });
});

after(async () => {
  await db?.dropDatabase();
  await client?.close();
});

const listing = (id: ObjectId) => db.collection(COLL.listings).findOne({ _id: id });

test("counts pending and migration-approved links", async () => {
  assert.deepEqual(await linkCounts(db), { cropPending: 2, cropCheck: 1, mandiPending: 1, mandiCheck: 0 });
});

test("approving a crop name sets the product on its listings, records who decided, and leaves prices alone", async () => {
  const pricesBefore = await db.collection(COLL.prices).find().toArray();
  const res = await decideCropName(db, user, ids.cnSona, { status: "approved", productId: ids.paddy });
  assert.equal(res.listings, 2);
  assert.equal(String((await listing(ids.l3))!.product_id), String(ids.paddy));
  const row = await db.collection(COLL.cropNames).findOne({ _id: ids.cnSona });
  assert.equal(row!.status, "approved");
  assert.equal(row!.decided_by, "tester");
  assert.deepEqual(await db.collection(COLL.prices).find().toArray(), pricesBefore);
  assert.equal(await db.collection(COLL.audit).countDocuments({ action: "crop_name.approved" }), 1);
});

test("a variety-specific link overrides the any-variety link for that variety only", async () => {
  const { productId: basmati } = await createCrop(db, user, "basmati paddy");
  const vid = await addVarietyLink(db, user, ids.cnSona, "basmati");
  await decideCropName(db, user, vid as ObjectId, { status: "approved", productId: basmati });
  assert.equal(String((await listing(ids.l4))!.product_id), String(basmati));
  assert.equal(String((await listing(ids.l3))!.product_id), String(ids.paddy));
  // Re-deciding the "*" row must not overwrite the basmati listing.
  await decideCropName(db, user, ids.cnSona, { status: "approved", productId: ids.paddy });
  assert.equal(String((await listing(ids.l4))!.product_id), String(basmati));
});

test("rejecting a crop name clears the product from its listings", async () => {
  await decideCropName(db, user, ids.cnPaddy, { status: "rejected" });
  assert.equal((await listing(ids.l1))!.product_id, null);
  assert.equal((await db.collection(COLL.cropNames).findOne({ _id: ids.cnPaddy }))!.needs_check, false);
  await decideCropName(db, user, ids.cnPaddy, { status: "approved", productId: ids.paddy });
  assert.equal(String((await listing(ids.l1))!.product_id), String(ids.paddy));
});

test("approving needs a product, and a new product can be added to a crop", async () => {
  await assert.rejects(decideCropName(db, user, ids.cnHen, { status: "approved" }), /Choose a product/);
  const poultry = await createCrop(db, user, "poultry");
  const hen = await createProduct(db, user, poultry.cropId, "hen");
  await decideCropName(db, user, ids.cnHen, { status: "approved", productId: hen });
  assert.equal(String((await listing(ids.l2))!.product_id), String(hen));
  await assert.rejects(createCrop(db, user, "Poultry"), /already exists/);
  await updateCrop(db, user, poultry.cropId, { defaultProductId: hen });
  assert.equal(String((await db.collection(COLL.crops).findOne({ _id: poultry.cropId }))!.default_product_id), String(hen));
  await assert.rejects(updateCrop(db, user, poultry.cropId, { defaultProductId: ids.paddy }), /belong to this crop/);
});

test("approving a mandi name sets mandi_id on its listings; available_mandi is not changed", async () => {
  const before = await db.collection(COLL.mandis).findOne({ _id: ids.pendurthi });
  const res = await decideMandiName(db, user, ids.mnPendurti, { status: "approved", mandiId: ids.pendurthi });
  assert.equal(res.listings, 1);
  assert.equal(String((await listing(ids.l1))!.mandi_id), String(ids.pendurthi));
  assert.deepEqual(await db.collection(COLL.mandis).findOne({ _id: ids.pendurthi }), before);
});

test("a new mandi uses only the existing available_mandi fields", async () => {
  const id = await createMandi(db, user, { name: "New Mandi", state: "Andhra Pradesh", district: "Kurnool", lat: 15.8, lon: 78.0 });
  const doc = await db.collection(COLL.mandis).findOne({ _id: id });
  assert.deepEqual(Object.keys(doc!).sort(), ["_id", "aliases", "createdAt", "district", "location", "name", "postcode", "source", "state", "updatedAt"]);
});

test("adding a state spelling fills state_code on listings and refuses spellings owned by another state", async () => {
  await db.collection(COLL.states).insertOne({ _id: "telangana" as unknown as ObjectId, name: "telangana", spellings: ["telangana"] });
  const res = await addStateSpelling(db, user, "andhra-pradesh", "A.P.");
  assert.equal(res.listings, 1);
  assert.equal((await listing(ids.l5))!.state_code, "andhra-pradesh");
  await assert.rejects(addStateSpelling(db, user, "telangana", "a.p."), /already belongs/);
});

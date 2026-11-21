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
  addCropWord, addStateSpelling, addVarietyLink, createCrop, createProduct, decideCropName, decideCropWord, decideMandiName,
  linkCounts, updateCrop, wordKey,
} from "../src/lib/catalog";
import { COLL } from "../src/lib/db";
import { createMandi } from "../src/lib/mandis";
import { autoMergeSafeDuplicates, findDuplicateGroups, mergeDuplicatesInto, mergeOneInto } from "../src/lib/mandi-duplicates";
import { confidentMandiGuesses } from "../src/lib/mandi-match";
import { badPriceCounts, deletePrices, editPrice, listBadPrices } from "../src/lib/prices";

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
  assert.deepEqual(await linkCounts(db), { cropPending: 2, cropCheck: 1, mandiPending: 1, mandiCheck: 0, wordPending: 0, wordCheck: 0 });
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

test("word key matches the scraper and the tool", () => {
  assert.equal(wordKey("Bengal Gram(Gram)(Whole)"), "bengal gram whole");
  assert.equal(wordKey("Ginger (Dry)"), wordKey("dry ginger"));
  assert.equal(wordKey("धान"), "धान");
  assert.equal(wordKey("मूंगफली (दाना)"), wordKey("दाना मूंगफली"));
});

test("farmer words: approve, add, refuse duplicates, reject", async () => {
  const { insertedId } = await db.collection(COLL.cropWords).insertOne({
    key: "rice", word: "rice", crop_id: null, product_id: null, status: "pending",
    suggestion: { reason: "claimed by 2 crops" }, sources: ["v1_alias", "crop_master:Telugu"],
  });
  await assert.rejects(decideCropWord(db, user, insertedId, { status: "approved" }), /Choose the product/);
  const label = await decideCropWord(db, user, insertedId, { status: "approved", productId: ids.paddy });
  assert.equal(label, "paddy");
  const row = await db.collection(COLL.cropWords).findOne({ _id: insertedId });
  assert.equal(String(row!.crop_id), String(ids.paddyCrop));
  assert.equal(row!.decided_by, "tester");

  await addCropWord(db, user, "Moong Phali", ids.groundnut, "Hindi");
  const added = await db.collection(COLL.cropWords).findOne({ key: "moong phali" });
  assert.equal(added!.status, "approved");
  await assert.rejects(addCropWord(db, user, "phali moong", ids.groundnut), /already in the list/);

  await decideCropWord(db, user, insertedId, { status: "rejected" });
  assert.equal((await db.collection(COLL.cropWords).findOne({ _id: insertedId }))!.product_id, null);
  assert.equal(await db.collection(COLL.audit).countDocuments({ action: /^crop_word\./ }), 3); // refused attempts write nothing
});

test("wrong prices: listed by problem, deleted with a copy kept, edited with checks", async () => {
  const day = new Date("2026-10-29");
  const p = db.collection(COLL.prices);
  const { insertedIds } = await p.insertMany([
    { market_commodity_id: ids.l1, date: day, min_price: 0, max_price: 0, modal_price: 0 },
    { market_commodity_id: ids.l2, date: day, min_price: 3000, max_price: 2000, modal_price: 2500 },
    { market_commodity_id: ids.l3, date: day, min_price: 2000, max_price: 3000, modal_price: 3500 },
    { market_commodity_id: ids.l4, date: day, min_price: null, max_price: null, modal_price: 2400 }, // modal only: fine
    { market_commodity_id: ids.l5, date: day, min_price: 2000, max_price: 3000, modal_price: 2500 }, // fine
    { market_commodity_id: ids.l5, date: new Date("2026-10-30"), min_price: 2000, max_price: 3000, modal_price: null }, // real, modal not read
    { market_commodity_id: ids.l5, date: new Date("2026-10-31"), min_price: null, max_price: null, modal_price: null },
  ]);
  const [zero, minAbove, modalOut, modalOnly, good, noModal, empty] = Object.values(insertedIds);
  await db.collection(COLL.review).insertOne({
    key: "k", type: "price_invalid", status: "open",
    details: { market_name: "pendurti", commodity_name: "paddy(common)", date: "2026-10-29" },
  });

  const counts = await badPriceCounts(db);
  assert.deepEqual(counts, { zero: 1, min_above_max: 1, modal_outside: 1, no_price: 1, modal_missing: 1 });
  const listed = await listBadPrices(db, { state: "andhra-pradesh" }, 1, 50);
  assert.equal(listed.total, 5); // the five wrong ones; l4's modal-only price and l5's good price are not listed
  assert.equal(listed.rows[0].mc?.market_name !== undefined, true);

  // Good prices are never deleted, even when ticked.
  await assert.rejects(deletePrices(db, user, { ids: [good, modalOnly] }, "test"), /nothing was deleted/);
  const res = await deletePrices(db, user, { ids: [zero, good] }, "all zero");
  assert.deepEqual(res, { deleted: 1, closed: 1 });
  assert.equal(await p.countDocuments({ _id: zero }), 0);
  assert.equal(await p.countDocuments({ _id: good }), 1);
  const copy = await db.collection(COLL.deletedPrices).findOne({ _id: zero });
  assert.equal(copy!.deleted_by, "tester");
  assert.equal(copy!.delete_reason, "all zero");
  assert.deepEqual(copy!.problems, ["zero"]);
  assert.equal((await db.collection(COLL.review).findOne({ key: "k" }))!.status, "resolved");

  await assert.rejects(editPrice(db, user, minAbove, { min: 3000, max: 2000, modal: 2500 }), /Min price cannot be above/);
  await assert.rejects(editPrice(db, user, minAbove, { min: 2000, max: 3000, modal: 0 }), /above 0/);
  await editPrice(db, user, minAbove, { min: 2000, max: 3000, modal: 2500 });
  await editPrice(db, user, minAbove, { min: 2100, max: 3000, modal: 2500 });
  const edited = await p.findOne({ _id: minAbove });
  assert.equal(edited!.min_price, 2100);
  assert.deepEqual(edited!.price_before_edit, { min_price: 3000, max_price: 2000, modal_price: 2500 }); // first scraped values kept

  // Real prices missing only their modal can't be bulk-deleted, and delete-all needs one problem.
  await assert.rejects(deletePrices(db, user, { all: { problem: "modal_missing" } }, ""), /not on prices that only lack a modal/);
  await assert.rejects(deletePrices(db, user, { all: {} }, ""), /one problem at a time/);
  assert.equal(await p.countDocuments({ _id: noModal }), 1);
  assert.equal((await deletePrices(db, user, { all: { problem: "no_price" } }, "")).deleted, 1);
  assert.equal(await p.countDocuments({ _id: empty }), 0);
  const all = await deletePrices(db, user, { all: { problem: "modal_outside" } }, "");
  assert.equal(all.deleted, 1);
  assert.equal(await p.countDocuments({ _id: modalOut }), 0);
  assert.deepEqual(await badPriceCounts(db), { zero: 0, min_above_max: 0, modal_outside: 0, no_price: 0, modal_missing: 1 });
  assert.equal(await db.collection(COLL.audit).countDocuments({ action: /^price\./ }), 5);
});

test("duplicate mandis: found, merged onto the most complete copy, and no longer split prices", async () => {
  const gj = "gujarat";
  await db.collection(COLL.states).insertOne({ _id: gj as unknown as ObjectId, name: "gujarat", spellings: ["gujarat", "guj"] });
  const [full, bare, other, lone] = [new ObjectId(), new ObjectId(), new ObjectId(), new ObjectId()];
  await db.collection(COLL.mandis).insertMany([
    { _id: full, name: "Unjha APMC", state: "gujarat", district: "Mehsana", postcode: "384170", location: { type: "Point", coordinates: [72.4, 23.8] } },
    { _id: bare, name: "unjha", state: "guj" },
    { _id: other, name: "Unjha (Mandi)", state: "gujarat", district: "Surat" },
    { _id: lone, name: "Palanpur", state: "gujarat", district: "Banaskantha" },
  ]);
  const [nA, nB, pend] = [new ObjectId(), new ObjectId(), new ObjectId()];
  await db.collection(COLL.mandiNames).insertMany([
    { _id: nA, source: "agmarknet", state_code: gj, raw_name: "unjha", mandi_id: full, status: "approved", listings: 5, suggestion: { mandi_id: bare } },
    { _id: nB, source: "enam", state_code: gj, raw_name: "unjha apmc", mandi_id: bare, status: "approved", listings: 3 },
    { _id: pend, source: "ap", state_code: gj, raw_name: "Unjha Mandi", mandi_id: null, status: "pending", listings: 1 },
  ]);
  await db.collection(COLL.listings).insertMany([
    { _id: new ObjectId(), source_system: "enam", state_code: gj, market_name: "unjha apmc", mandi_id: bare },
    { _id: new ObjectId(), source_system: "enam", state_code: gj, market_name: "unjha apmc", mandi_id: bare },
  ]);

  const groups = await findDuplicateGroups(db, { state: gj });
  assert.equal(groups.length, 1); // Palanpur has no copy; spellings "guj"/"gujarat" are one state
  const g = groups[0];
  assert.equal(g.members.length, 3);
  assert.equal(g.safe, false); // Mehsana vs Surat could be two places
  assert.equal(g.waiting.length, 1);
  // A district conflict is never merged automatically and blocks the exact-match approval.
  assert.deepEqual(await autoMergeSafeDuplicates(db, user, gj), { groups: 0, names: 0, listings: 0 });
  assert.equal((await confidentMandiGuesses(db, { state: gj })).total, 0);

  await db.collection(COLL.mandis).updateOne({ _id: other }, { $set: { district: "Mehsana" } });
  const safe = (await findDuplicateGroups(db, { state: gj }))[0];
  assert.equal(safe.safe, true);
  assert.equal(String(safe.members[0]._id), String(full));
  assert.equal(safe.linkedCopies, 2);
  const guesses = await confidentMandiGuesses(db, { state: gj });
  assert.equal(guesses.total, 1); // the pending name now resolves to the kept copy
  assert.equal(String(guesses.items[0].mandiId), String(full));

  const res = await autoMergeSafeDuplicates(db, user, gj);
  assert.deepEqual(res, { groups: 1, names: 1, listings: 2 });
  const moved = await db.collection(COLL.mandiNames).findOne({ _id: nB });
  assert.equal(String(moved!.mandi_id), String(full));
  assert.equal(moved!.needs_check, true);
  assert.equal(String((await db.collection(COLL.mandiNames).findOne({ _id: nA }))!.suggestion!.mandi_id), String(full));
  assert.equal(await db.collection(COLL.listings).countDocuments({ mandi_id: bare }), 0);
  assert.equal(await db.collection(COLL.listings).countDocuments({ mandi_id: full }), 2);
  assert.equal(await db.collection(COLL.mandis).countDocuments({ state: { $in: ["gujarat", "guj"] } }), 4); // available_mandi untouched
  assert.equal((await findDuplicateGroups(db, { state: gj }))[0].linkedCopies, 1);
  assert.equal(await db.collection(COLL.audit).countDocuments({ action: "mandi_duplicate.auto_merge" }), 1);
  await assert.rejects(mergeDuplicatesInto(db, user, lone), /No other mandi has the same name/);
});

test("duplicate mandis: merging one pair moves only that copy's names", async () => {
  await db.collection(COLL.states).insertOne({ _id: "kerala" as unknown as ObjectId, name: "kerala", spellings: ["kerala"] });
  const [x, y, z, other] = [new ObjectId(), new ObjectId(), new ObjectId(), new ObjectId()];
  await db.collection(COLL.mandis).insertMany([
    { _id: x, name: "Kozhikode", state: "kerala", district: "Kozhikode" },
    { _id: y, name: "Kozhikode APMC", state: "kerala", district: "Kozhikode" },
    { _id: z, name: "Kozhikode Mandi", state: "kerala", district: "Wayanad" },
    { _id: other, name: "Thrissur", state: "kerala" },
  ]);
  const mk = (raw: string, mandi: ObjectId) => ({ _id: new ObjectId(), source: "agmarknet", state_code: "kerala", raw_name: raw, mandi_id: mandi, status: "approved", listings: 2 });
  const [nx, ny, nz] = [mk("kozhikode", x), mk("kozhikode apmc", y), mk("kozhikode mandi", z)];
  await db.collection(COLL.mandiNames).insertMany([nx, ny, nz]);
  const r = await mergeOneInto(db, user, y, x);
  assert.equal(r.names, 1);
  const at = async (n: { _id: ObjectId }) => String((await db.collection(COLL.mandiNames).findOne({ _id: n._id }))!.mandi_id);
  assert.equal(await at(ny), String(x));
  assert.equal(await at(nz), String(z)); // the different-district copy is untouched
  await assert.rejects(mergeOneInto(db, user, other, x), /not same-named copies/);
  await assert.rejects(mergeOneInto(db, user, x, x), /two different mandis/);
  assert.equal(await db.collection(COLL.audit).countDocuments({ action: "mandi_duplicate.merge_one" }), 1);
});

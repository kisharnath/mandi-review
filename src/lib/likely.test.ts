import assert from "node:assert/strict";
import { test } from "node:test";
import { likelyMandis, likelyProducts } from "./likely";

test("APMC is ignored and both spellings of the mandi are offered", () => {
  const db = [{ _id: 1, name: "abc" }, { _id: 2, name: "abc apmc" }, { _id: 3, name: "xyz" }];
  const r = likelyMandis("ABC APMC", db);
  assert.deepEqual(r.map((m) => m._id).sort(), [1, 2]);
  assert.equal(r[0].score, r[1].score);
});

test("district breaks ties and small spelling slips still match", () => {
  const db = [{ _id: 1, name: "Khanna", district: "Ludhiana" }, { _id: 2, name: "Khanna APMC", district: "Other" }];
  assert.equal(likelyMandis("khana mandi", db, "ludhiana")[0]._id, 1);
});

test("products match plurals, brackets and word order", () => {
  const db = [{ _id: 1, name: "green chilli" }, { _id: 2, name: "dry chilli" }, { _id: 3, name: "wheat" }];
  assert.equal(likelyProducts("Green Chillies (Local)", db)[0]._id, 1);
  assert.ok(!likelyProducts("Chillies", db).some((p) => p._id === 3));
});

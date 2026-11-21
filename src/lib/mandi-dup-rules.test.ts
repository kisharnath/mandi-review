import assert from "node:assert/strict";
import { test } from "node:test";
import { completeness, districtsCompatible, rankMandis } from "./mandi-dup-rules";

const m = (id: string, extra: Record<string, unknown> = {}) => ({ _id: id, ...extra });

test("copies with the same or a missing district are safe to merge", () => {
  assert.equal(districtsCompatible([m("a", { district: "Pune" }), m("b", { district: " pune " }), m("c")]), true);
  assert.equal(districtsCompatible([m("a"), m("b")]), true);
});

test("copies in different districts are left for a person", () => {
  assert.equal(districtsCompatible([m("a", { district: "Pune" }), m("b", { district: "Nashik" })]), false);
});

test("the copy with most listings is kept, then the most complete record", () => {
  const bare = m("a", { listings: 500 });
  const full = m("b", { district: "Pune", postcode: "411001", location: { type: "Point" }, listings: 10 });
  const mid = m("c", { district: "Pune", listings: 900 });
  assert.equal(completeness(full), 3);
  assert.deepEqual(rankMandis([bare, mid, full]).map((x) => x._id), ["c", "a", "b"]);
  assert.deepEqual(rankMandis([m("p"), m("q", { district: "Pune" })]).map((x) => x._id), ["q", "p"]); // no listings anywhere: completeness decides
  assert.deepEqual(rankMandis([m("x", { listings: 1 }), m("y", { listings: 7 })]).map((x) => x._id), ["y", "x"]);
});

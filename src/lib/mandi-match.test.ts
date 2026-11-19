import assert from "node:assert/strict";
import { test } from "node:test";
import { mandiKey } from "./heuristics";

test("cleans spelling noise so the same mandi matches", () => {
  assert.equal(mandiKey("Azadpur (F&V)"), mandiKey("AZADPUR MANDI"));
  assert.equal(mandiKey("Khanna APMC"), "khanna");
  assert.notEqual(mandiKey("Sadar Bazar"), mandiKey("Sadar Road"));
});

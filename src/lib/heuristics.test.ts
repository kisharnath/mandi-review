import assert from "node:assert/strict";
import { test } from "node:test";
import { isOtherScript, looksWrong } from "./heuristics";

test("flags names unrelated to their crop group", () => {
  assert.equal(looksWrong("hen", "groundnut", ["groundnut", "hen", "ground nut seed"]), true);
  assert.equal(looksWrong("she baffalo (for each)", "groundnut", ["groundnut"]), true);
  assert.equal(looksWrong("tur", "brinjal", ["brinjal", "tur"]), true);
  assert.equal(looksWrong("maida atta", "paddy", ["paddy", "paddy(common)", "maida atta"]), true);
});

test("accepts qualifiers and spelling variants of the group name", () => {
  assert.equal(looksWrong("paddy(common)", "paddy", ["paddy"]), false);
  assert.equal(looksWrong("bajra(pearl millet/cumbu)", "pearl millet", []), false);
  assert.equal(looksWrong("soyabean", "soybean", []), false);
  assert.equal(looksWrong("raddish", "radish", []), false);
  assert.equal(looksWrong("cummin seed(jeera)", "cumin", []), false);
});

test("aliases count only when they themselves relate to the group name", () => {
  // "hen" is (wrongly) an alias of groundnut; that must not make "hens/cock" look fine.
  assert.equal(looksWrong("hens/cock", "groundnut", ["hen"]), true);
});

test("local scripts are not judged by spelling", () => {
  assert.equal(isOtherScript("मूंगफली (दाना)"), true);
  assert.equal(looksWrong("मूंगफली (दाना)", "groundnut", []), false);
  assert.equal(isOtherScript("paddy(common)"), false);
});

import assert from "node:assert/strict";
import test from "node:test";
import { buildScenarioDistrictGroupByFeatureId, getScenarioDistrictCountryGrouping } from "../js/core/scenario/scenario_districts.js";

const payload = {
  tags: {
    AA: { districts: {
      first: { feature_ids: ["z", "a", "cross", "within", "legacy-conflict", "a"] },
      second: { feature_ids: ["within", "b"] },
    } },
    BB: { districts: { third: { feature_ids: ["cross", "c", "owned"] } } },
    CC: { districts: {} },
  },
  legacy_countries: {
    FR: { districts: {
      old: { feature_ids: ["legacy-conflict", "legacy", "owned", "legacy-duplicate"] },
      other: { feature_ids: ["legacy-duplicate", "last"] },
    } },
    DE: { districts: {} },
  },
};

function grouping(country, ids, owners) {
  const entries = ids.map(id => ({ id }));
  return getScenarioDistrictCountryGrouping(payload, country, entries, owners);
}

test("indexed grouping preserves declaration order, conflicts, owners and legacy rules", () => {
  const ids = ["last", "owned", "c", "b", "z", "within", "cross", "legacy-conflict", "legacy", "legacy-duplicate", "a", "a"];
  assert.deepEqual([...grouping("FR", ids, {})], [
    ["a", "AA::first"], ["z", "AA::first"], ["b", "AA::second"],
    ["c", "BB::third"], ["legacy", "old"], ["last", "other"],
  ]);
  assert.equal(buildScenarioDistrictGroupByFeatureId(payload).get("cross"), "first");
});

test("declared distinguishes owner-only, membership, legacy and absent definitions", () => {
  assert.deepEqual([...grouping("GB", ["unlisted"], { unlisted: " cc " })], []);
  assert.deepEqual([...grouping("GB", ["a"], {})], [["a", "AA::first"]]);
  assert.equal(grouping("GB", ["a"], { a: "ZZ" }), null);
});

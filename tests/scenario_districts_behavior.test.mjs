import assert from "node:assert/strict";
import test from "node:test";
import {
  buildScenarioDistrictGroupByFeatureId,
  getScenarioDistrictCountryGrouping,
  normalizeGeoCountryCode,
  normalizeScenarioDistrictGroupsPayload,
} from "../js/core/scenario_districts.js";

function referenceGrouping(payload, countryCode, featureEntries, owners = {}) {
  if (!payload || typeof payload !== "object") return null;
  const normalized = normalizeScenarioDistrictGroupsPayload(payload);
  const country = normalizeGeoCountryCode(countryCode);
  const ids = new Set(featureEntries.map((entry) => entry.id));
  const groups = new Map();
  const conflicts = new Set();
  let declared = false;
  const add = (id, key) => {
    if (groups.has(id) && groups.get(id) !== key) conflicts.add(id);
    else groups.set(id, key);
  };
  for (const [tag, record] of Object.entries(normalized.tags)) {
    if (featureEntries.some(({ id }) => String(owners[id] || "").trim().toUpperCase() === tag)) declared = true;
    for (const [districtId, district] of Object.entries(record.districts)) {
      for (const id of district.feature_ids) {
        if (!ids.has(id)) continue;
        const currentOwner = String(owners[id] || "").trim().toUpperCase();
        if (currentOwner && currentOwner !== tag) continue;
        declared = true;
        add(id, `${tag}::${districtId}`);
      }
    }
  }
  const legacy = normalized.legacy_countries[country];
  if (legacy) {
    declared = true;
    for (const [districtId, district] of Object.entries(legacy.districts)) {
      for (const id of district.feature_ids) {
        const currentOwner = String(owners[id] || "").trim().toUpperCase();
        if (ids.has(id) && !normalized.tags[currentOwner]) add(id, districtId);
      }
    }
  }
  for (const id of conflicts) groups.delete(id);
  return { groups, conflicts, declared };
}

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

function assertReference(country, ids, owners) {
  const entries = ids.map(id => ({ id }));
  const expected = referenceGrouping(payload, country, entries, owners);
  const actual = getScenarioDistrictCountryGrouping(payload, country, entries, owners);
  assert.equal(actual !== null, expected.declared);
  assert.deepEqual(actual === null ? [] : [...actual], [...expected.groups]);
  for (const id of expected.conflicts) assert.equal(actual.has(id), false, id);
  return actual;
}

test("indexed grouping preserves declaration order, conflicts, owners and legacy rules", () => {
  const ids = ["last", "owned", "c", "b", "z", "within", "cross", "legacy-conflict", "legacy", "legacy-duplicate", "a", "a"];
  for (const country of [" fr ", "DE", "GB", "invalid"]) {
    for (const owners of [{}, { cross: " bb ", within: "AA", owned: "BB", legacy: "ZZ" }, { z: "ZZ", owned: "ZZ", "legacy-conflict": "AA" }]) {
      assertReference(country, ids, owners);
    }
  }
  assert.deepEqual([...assertReference("FR", ids, {})], [
    ["a", "AA::first"], ["z", "AA::first"], ["b", "AA::second"],
    ["c", "BB::third"], ["legacy", "old"], ["last", "other"],
  ]);
  assert.equal(buildScenarioDistrictGroupByFeatureId(payload).get("cross"), "first");
});

test("declared distinguishes owner-only, membership, legacy and absent definitions", () => {
  assert.deepEqual([...assertReference("GB", ["unlisted"], { unlisted: " cc " })], []);
  assert.deepEqual([...assertReference("GB", ["a"], {})], [["a", "AA::first"]]);
  assert.equal(assertReference("GB", ["a"], { a: "ZZ" }), null);
  assert.equal(assertReference("GB", ["unlisted"], {}), null);
  assert.deepEqual([...assertReference("DE", [], {})], []);
  assert.equal(assertReference("GB", [], {}), null);
  assert.equal(getScenarioDistrictCountryGrouping(null, "FR", []), null);
});

test("one payload is normalized once across countries and returned maps remain independent", () => {
  let enumerations = 0;
  const source = { ...payload, tags: new Proxy(payload.tags, {
    ownKeys(target) { enumerations += 1; return Reflect.ownKeys(target); },
  }) };
  const entries = [{ id: "a" }, { id: "legacy" }];
  const first = getScenarioDistrictCountryGrouping(source, "FR", entries);
  const second = getScenarioDistrictCountryGrouping(source, "DE", entries);
  assert.equal(enumerations, 1);
  assert.deepEqual([...first], [["a", "AA::first"], ["legacy", "old"]]);
  assert.deepEqual([...second], [["a", "AA::first"]]);
  first.clear();
  assert.deepEqual([...getScenarioDistrictCountryGrouping(source, "FR", entries)], [["a", "AA::first"], ["legacy", "old"]]);
  assert.equal(normalizeScenarioDistrictGroupsPayload(source, "one").scenario_id, "one");
  assert.equal(normalizeScenarioDistrictGroupsPayload(source, "two").scenario_id, "two");
  assert.equal(enumerations, 1);
});

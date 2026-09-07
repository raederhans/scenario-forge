import test from "node:test";
import assert from "node:assert/strict";
import * as pureHelpers from "../js/core/scenario/pure_helpers.js";

test("scenario collections preserve feature identity and normalize missing payloads", () => {
  const features = [{ id: " first " }, { properties: { id: "second" } }, null, {}];
  const normalized = pureHelpers.normalizeScenarioFeatureCollection({ features, extra: true });
  assert.deepEqual(normalized, { type: "FeatureCollection", features });
  assert.equal(normalized.features, features);
  assert.deepEqual(pureHelpers.getScenarioFeatureCollectionIdentityList(normalized), ["first", "second"]);
  for (const invalid of [null, undefined, {}, { features: {} }]) {
    assert.equal(pureHelpers.normalizeScenarioFeatureCollection(invalid), null);
    assert.deepEqual(pureHelpers.getScenarioFeatureCollectionIdentityList(invalid), []);
    assert.equal(pureHelpers.areScenarioFeatureCollectionsEquivalent(invalid, { features: [] }), true);
  }
});

test("scenario collection equivalence detects replacements and ordering without reading feature IDs", () => {
  const first = { id: "same", properties: { version: 1 } };
  const second = { id: "second" };
  const original = { features: [first, second] };
  const replacement = { id: "same", properties: { version: 2 } };
  assert.equal(pureHelpers.areScenarioFeatureCollectionsEquivalent(original, { features: [first, second] }), true);
  for (const features of [[replacement, second], [second, first], [first], [first, second, second]]) {
    assert.equal(pureHelpers.areScenarioFeatureCollectionsEquivalent(original, { features }), false);
  }
  const unreadId = { get id() { throw new Error("equivalence must not build ID lists"); } };
  assert.equal(pureHelpers.areScenarioFeatureCollectionsEquivalent({ features: [unreadId] }, { features: [unreadId] }), true);
  assert.equal(pureHelpers.areScenarioFeatureCollectionsEquivalent({ features: new Array(1) }, { features: [first] }), false);
});

test("getHoi4FarEastSovietRuntimeCandidateFeatureIds uses topology identity cache on repeated calls", () => {
  const topology = {
    objects: {
      political: {
        geometries: [
          { properties: { id: "RU-1", cntr_code: "RU" } },
          { properties: { id: "RU-2", cntr_code: "RU" } },
          { properties: { id: "JP-1", cntr_code: "JP" } },
        ],
      },
    },
  };

  const first = pureHelpers.getHoi4FarEastSovietRuntimeCandidateFeatureIds(topology);
  const second = pureHelpers.getHoi4FarEastSovietRuntimeCandidateFeatureIds(topology);

  assert.equal(second, first);
  assert.deepEqual(second, ["RU-1", "RU-2"]);
});

test("getHoi4FarEastSovietRuntimeCandidateFeatureIds keeps ordinary RU land while excluding water and base geography", () => {
  const topology = {
    objects: {
      political: {
        geometries: [
          { properties: { id: "RU-LAND", cntr_code: "RU" } },
          { properties: { id: "RU-SHELL-LAND", cntr_code: "RU", scenario_helper_kind: "shell_fallback", render_as_base_geography: false } },
          { properties: { id: "RU-WATER", cntr_code: "RU", water_type: "sea", region_group: "marine_macro" } },
          { properties: { id: "RU-BASE-WATER", cntr_code: "RU", render_as_base_geography: true, source_layer: "marine_macro" } },
          { properties: { id: "RU-BASE-LAND", cntr_code: "RU", render_as_base_geography: true } },
          { properties: { id: "JP-LAND", cntr_code: "JP" } },
        ],
      },
    },
  };

  assert.deepEqual(
    pureHelpers.getHoi4FarEastSovietRuntimeCandidateFeatureIds(topology),
    ["RU-LAND", "RU-SHELL-LAND"],
  );
  assert.equal(
    pureHelpers.isHoi4FarEastSovietBackfillLandCandidate({
      properties: { id: "RU-WATER", water_type: "sea" },
    }, "RU-WATER"),
    false,
  );
});

test("buildHoi4FarEastSovietOwnerBackfill reuses cached candidate ids and respects explicit assignments", () => {
  const topology = {
    objects: {
      political: {
        geometries: [
          { properties: { id: "RU-1", cntr_code: "RU" } },
          { properties: { id: "RU-2", cntr_code: "RU" } },
        ],
      },
    },
  };

  const firstBackfill = pureHelpers.buildHoi4FarEastSovietOwnerBackfill("hoi4_1939", {
    runtimeTopology: topology,
    ownersByFeatureId: { "RU-1": "SOV" },
    controllersByFeatureId: {},
  });
  const secondBackfill = pureHelpers.buildHoi4FarEastSovietOwnerBackfill("hoi4_1939", {
    runtimeTopology: topology,
    ownersByFeatureId: {},
    controllersByFeatureId: {},
  });

  assert.deepEqual(firstBackfill, { "RU-2": "SOV" });
  assert.deepEqual(secondBackfill, { "RU-1": "SOV", "RU-2": "SOV" });
});

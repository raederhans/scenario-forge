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

test("Far East owner backfill respects explicit assignments", () => {
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
  assert.deepEqual(firstBackfill, { "RU-2": "SOV" });
});

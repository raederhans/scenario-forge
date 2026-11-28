import assert from "node:assert/strict";
import test from "node:test";
import { createPoliticalCollectionOwner } from "../js/core/renderer/political_collection_owner.js";
import { createPoliticalGeometryStore, getPoliticalGeometrySnapshot } from "../js/core/political_geometry_store.js";

const originalD3 = globalThis.d3;
test.after(() => { globalThis.d3 = originalD3; });

function fixture(count = 850) {
  globalThis.d3 = { geoArea: () => 1 };
  const state = {};
  const features = Array.from({ length: count }, (_, id) => ({
    type: "Feature", id: String(id), properties: { id: String(id), country: "AA", tier: "leaf" },
    geometry: { type: "Point", coordinates: [id, 0] },
  }));
  const owner = createPoliticalCollectionOwner({ state,
    constants: { interactiveAggregateTierFilters: { AA: new Set(["aggregate"]) }, highFrequencyCountryDetailWhitelist: new Set(["AA"]) },
    helpers: { getFeatureId: (feature) => feature.id,
      getFeatureCountryCodeNormalized: (feature) => feature.properties.country,
      getDetailTier: (feature) => feature.properties.tier,
      isPoliticalInteractionRenderableFeature: (feature) => feature.properties.interactive !== false },
  });
  const store = createPoliticalGeometryStore();
  const payload = { type: "FeatureCollection", features };
  return { owner, collection: () => store.compose([payload]) };
}

test("chunked indexed composition preserves synchronous feature order", async () => {
  const f = fixture();
  const collection = f.collection();
  const result = await f.owner.composePoliticalFeatureCollectionsChunked(null, collection, null, {
    nowMs: () => 0, yieldControl: async () => {},
  });
  assert.equal(result.status, "prepared");
  const sync = f.owner.composePoliticalFeatureCollections(null, collection);
  assert.deepEqual(result.collection, sync);
});

test("promoting a feature from a finer source keeps its painter position", () => {
  const point = (id, x) => ({ type: "Feature", id, properties: { id }, geometry: { type: "Point", coordinates: [x, 0] } });
  const coarse = { type: "FeatureCollection", features: ["0", "1", "2", "3"].map((id, x) => point(id, x)) };
  const detailFeature = point("2", 2);
  const detail = { type: "FeatureCollection", features: [detailFeature] };
  const store = createPoliticalGeometryStore();
  store.compose([coarse]);
  const promoted = store.compose([detail, coarse]);
  assert.deepEqual(promoted.features.map((item) => item.id), ["0", "1", "2", "3"]);
  assert.equal(promoted.features[2], detailFeature);
  assert.deepEqual(getPoliticalGeometrySnapshot(promoted).changedIds, ["2"]);
  const demoted = store.compose([coarse]);
  assert.deepEqual(demoted.features.map((item) => item.id), ["0", "1", "2", "3"]);
  assert.equal(demoted.features[2], coarse.features[2]);
});

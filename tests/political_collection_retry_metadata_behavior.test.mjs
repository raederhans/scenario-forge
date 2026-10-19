import assert from "node:assert/strict";
import test from "node:test";
import { createPoliticalGeometryStore, getPoliticalGeometrySnapshot } from "../js/core/political_geometry_store.js";
import { createPoliticalCollectionOwner } from "../js/core/renderer/political_collection_owner.js";
import { createPoliticalDerivedStateCache } from "../js/core/renderer/political_derived_state_cache.js";

test("metadata delta survives cancellation after complete composition until the retry is committed", async (t) => {
  const originalD3 = globalThis.d3;
  t.after(() => { globalThis.d3 = originalD3; });
  globalThis.d3 = { geoArea: () => 1 };
  const getFeatureId = (feature) => feature.id;
  const owner = createPoliticalCollectionOwner({ state: {}, helpers: { getFeatureId } });
  const cache = createPoliticalDerivedStateCache({ getFeatureId });
  const store = createPoliticalGeometryStore();
  const feature = {
    type: "Feature", id: "a", properties: { name: "original" },
    geometry: { type: "Point", coordinates: [0, 0] },
  };
  const payload = { type: "FeatureCollection", features: [feature] };
  const base = owner.composePoliticalFeatureCollections(null, store.compose([payload]));
  const identity = ["scene"];
  const colors = { a: "red" };
  const baseline = { identity, colors, colorRevision: 1 };
  cache.commit({ ...baseline, collection: base });

  feature.properties.name = "edited";
  const input = store.compose([payload]);
  const inputSnapshot = getPoliticalGeometrySnapshot(input);
  assert.equal(inputSnapshot.previousRevision, getPoliticalGeometrySnapshot(base).revision);
  assert.deepEqual(inputSnapshot.changedIds, [], "the unchanged payload index cannot detect metadata edits");
  const compose = () => owner.composePoliticalFeatureCollectionsChunked(null, input);
  const uncommitted = await compose();
  assert.equal(uncommitted.status, "prepared");
  assert.deepEqual(getPoliticalGeometrySnapshot(uncommitted.collection).changedIds, ["a"]);
  // The caller cancels after composition, so the derived cache still owns base.
  const retry = await compose();
  assert.equal(retry.status, "prepared");
  assert.equal(retry.collection.features[0], uncommitted.collection.features[0]);
  assert.equal(retry.collection.features[0].properties.name, "edited");
  assert.equal(base.features[0].properties.name, "original");
  const retryDelta = cache.describe({ ...baseline, previousCollection: base, collection: retry.collection });
  assert.ok(retryDelta, "the original committed baseline remains eligible for an indexed delta");
  assert.deepEqual({
    snapshotChangedIds: getPoliticalGeometrySnapshot(retry.collection).changedIds,
    derivedChangedIds: retryDelta.changedIds,
    removedIds: retryDelta.removedIds,
  }, { snapshotChangedIds: ["a"], derivedChangedIds: ["a"], removedIds: [] });

  cache.commit({ ...baseline, collection: retry.collection });
  const repeated = await compose();
  assert.equal(repeated.status, "prepared");
  assert.deepEqual(cache.describe({ ...baseline, previousCollection: retry.collection,
    collection: repeated.collection }).changedIds, [], "a committed retry must not create another metadata delta");

  const next = owner.composePoliticalFeatureCollections(null, store.compose([payload]));
  assert.equal(getPoliticalGeometrySnapshot(next).previousRevision, inputSnapshot.revision);
  assert.deepEqual(getPoliticalGeometrySnapshot(next).changedIds, []);
  assert.deepEqual(cache.describe({ ...baseline, previousCollection: retry.collection,
    collection: next }).changedIds, [], "a later source revision remains unchanged after the retry commit");
});

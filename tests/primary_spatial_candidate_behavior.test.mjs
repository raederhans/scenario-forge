import assert from "node:assert/strict";
import test from "node:test";
import { createSpatialIndexRuntimeOwner } from "../js/core/renderer/spatial_index_runtime_owner.js";
import { createDefaultSpatialIndexState } from "../js/core/state/spatial_index_state.js";
import { collectSpatialItemsForProjectedRects } from "../js/core/renderer/spatial_query_index.js";

const feature = (id, x = 10, extra = {}) => ({ id, country: "AA", geometry: {},
  bounds: { minX: x, minY: x, maxX: x + 3, maxY: x + 3, area: 9 }, ...extra });
const fields = ["landIndex", "countryToFeatureIds", "idToKey", "keyToId", "projectedBoundsById",
  "spatialItems", "spatialGrid", "spatialGridMeta", "spatialItemsById"];
const snapshot = (state) => Object.fromEntries(fields.map((key) => [key, state[key]]));

function harness(features = [feature("a"), feature("b", 30)], constants = {}) {
  const state = { ...createDefaultSpatialIndexState(), landData: { features }, riversData: { features: [] },
    projectedBoundsById: new Map(), sphericalFeatureDiagnosticsById: new Map(), hitCanvasDirty: false };
  let dimensions = [800, 600], clock = 0, path = {};
  const computed = [], publicReads = [], culls = [];
  const owner = createSpatialIndexRuntimeOwner({ state, constants, getters: { getPathSvg: () => path }, helpers: {
    getLogicalCanvasDimensions: () => dimensions,
    getFeatureId: (f) => f.id || "",
    getFeatureCountryCodeNormalized: (f) => f.country || "",
    getFeatureBorderMeshCountryCodeNormalized: (f) => f.borderCountry || f.country || "",
    shouldExcludePoliticalInteractionFeature: (f) => !!f.excludedInteraction,
    shouldExcludePoliticalVisualFeature: (f) => !!f.excludedVisual,
    shouldSkipFeature: (f) => { culls.push(f); return !!f.skip; },
    computeProjectedFeatureBounds: (f) => { computed.push(f); clock += 0.1; return f.bounds; },
    getProjectedFeatureBounds: (f, { featureId }) => {
      publicReads.push(f);
      if (f.bounds) state.projectedBoundsById.set(featureId, f.bounds);
      else state.projectedBoundsById.delete(featureId);
      return f.bounds;
    },
    nowMs: () => clock,
  } });
  owner.rebuildRuntimePrimaryIndex({ projectedBoundsCache: state.projectedBoundsById });
  owner.buildSpatialIndex({ includeSecondary: false });
  state.hitCanvasDirty = false;
  computed.length = 0; publicReads.length = 0; culls.length = 0;
  return { state, owner, computed, publicReads, culls,
    setDimensions: (next) => { dimensions = next; }, setPath: (next) => { path = next; } };
}

test("primary candidate keeps live bounds, maps and hits immutable until atomic adoption", async () => {
  const h = harness();
  const old = snapshot(h.state), keys = new Map(h.state.idToKey);
  const oldGridContents = new Map([...h.state.spatialGrid].map(([id, bucket]) => [id, bucket.slice()]));
  const features = [feature("new", 70), h.state.landData.features[1], h.state.landData.features[0]];
  const prepared = await h.owner.preparePrimarySpatialCandidateChunked({ features,
    incrementalDelta: { changedIds: ["new"], removedIds: [] },
    projectedBoundsCache: h.state.projectedBoundsById, yieldControl: async () => {
      for (const key of fields) assert.equal(h.state[key], old[key], key);
      assert.deepEqual(h.state.spatialGrid, oldGridContents);
      assert.equal(h.state.hitCanvasDirty, false);
      const hits = collectSpatialItemsForProjectedRects({ grid: h.state.spatialGrid, gridMeta: h.state.spatialGridMeta,
        items: h.state.spatialItems, projectedRects: [{ minX: 0, minY: 0, maxX: 50, maxY: 50 }] });
      assert.deepEqual(hits.items.map((item) => item.id), ["a", "b"]);
    } });
  assert.equal(prepared.status, "prepared");
  assert.deepEqual(h.computed.map((f) => f.id), ["new"]);
  assert.equal(h.publicReads.length, 0, "candidate must not use live-publishing bounds lookup");
  assert.equal(h.owner.adoptPrimarySpatialCandidate(prepared.candidate).status, "published");
  assert.equal(h.state.hitCanvasDirty, true);
  assert.equal(h.state.idToKey.get("a"), keys.get("a"));
  assert.equal(h.state.idToKey.get("b"), keys.get("b"));
  assert.equal(h.state.keyToId.get(h.state.idToKey.get("new")), "new");
  assert.deepEqual(h.state.spatialItems.map((item) => [item.id, item.drawOrder]), [["new", 0], ["b", 1], ["a", 2]]);
  assert.equal(h.owner.adoptPrimarySpatialCandidate(prepared.candidate).status, "cancelled", "adoption is one-shot");
});

test("publication rechecks caller identity, layout and ownership after preparation has completed", async () => {
  for (const mutation of ["caller", "layout", "length", "foreign-owner"]) {
    const h = harness();
    let current = true;
    const features = [feature("new")];
    const prepared = await h.owner.preparePrimarySpatialCandidateChunked({ features, isCurrent: () => current });
    assert.equal(prepared.status, "prepared");
    if (mutation === "caller") current = false;
    if (mutation === "layout") h.setDimensions([900, 600]);
    if (mutation === "length") features.push(feature("late"));
    const target = mutation === "foreign-owner" ? harness() : h;
    const before = snapshot(target.state);
    assert.equal(target.owner.adoptPrimarySpatialCandidate(prepared.candidate).status, "cancelled", mutation);
    for (const key of fields) assert.equal(target.state[key], before[key]);
  }
});

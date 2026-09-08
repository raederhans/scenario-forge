import test from "node:test";
import assert from "node:assert/strict";

import { createSpatialIndexRuntimeOwner } from "../js/core/renderer/spatial_index_runtime_owner.js";
import { createDefaultSpatialIndexState } from "../js/core/state/spatial_index_state.js";

function bounds(seed) {
  return {
    minX: seed,
    minY: seed + 1,
    maxX: seed + 2,
    maxY: seed + 3,
    area: seed + 4,
  };
}

function createOwnerHarness({
  landFeatures = [],
  riverFeatures = [],
  computeProjectedFeatureBounds = () => null,
  shouldSkipFeature = () => false,
  getLogicalCanvasDimensions = () => [800, 600],
  yieldToMain = async () => {},
  chunkedSpatialBuildSliceSize = 400,
} = {}) {
  const state = {
    ...createDefaultSpatialIndexState(),
    landData: { type: "FeatureCollection", features: landFeatures },
    riversData: { type: "FeatureCollection", features: riverFeatures },
    hitCanvasDirty: false,
  };
  const owner = createSpatialIndexRuntimeOwner({
    state,
    constants: { chunkedSpatialBuildSliceSize },
    getters: {
      getPathSvg: () => ({}),
    },
    helpers: {
      yieldToMain,
      getFeatureId: (feature) => String(feature?.id || ""),
      getFeatureCountryCodeNormalized: (feature) => String(feature?.countryCode || ""),
      getFeatureBorderMeshCountryCodeNormalized: (feature) => String(feature?.countryCode || ""),
      shouldExcludePoliticalInteractionFeature: (feature) => !!feature?.excludedInteraction,
      shouldExcludePoliticalVisualFeature: (feature) => !!feature?.excludedVisual,
      computeProjectedFeatureBounds,
      shouldSkipFeature,
      getLogicalCanvasDimensions,
      getProjectedFeatureBounds: (feature) => feature?.bounds || null,
    },
  });
  return { owner, state };
}

for (const cancelAtYield of [1, 2]) {
  test(`chunked spatial build does not publish after invalidation at yield ${cancelAtYield}`, async () => {
    let current = true;
    let yields = 0;
    const { owner, state } = createOwnerHarness({
      landFeatures: [{ id: "a", bounds: bounds(1) }, { id: "b", bounds: bounds(2) }],
      chunkedSpatialBuildSliceSize: 1,
      yieldToMain: async () => { if (++yields === cancelAtYield) current = false; },
    });
    const originalItems = state.spatialItems;
    await owner.buildSpatialIndexChunked({ includeSecondary: false, isCurrent: () => current });
    assert.equal(state.spatialItems, originalItems);
    assert.equal(state.hitCanvasDirty, false);
    assert.equal(yields, cancelAtYield);
  });
}

test("runtime primary rebuild refreshes current land and river bounds without changing index semantics", () => {
  const land = { id: "land-a", countryCode: "AA" };
  const excluded = {
    id: "land-excluded",
    countryCode: "XX",
    excludedInteraction: true,
    excludedVisual: true,
  };
  const missingId = { countryCode: "BB" };
  const river = { id: "river-a" };
  const currentBounds = new Map([
    [land, bounds(10)],
    [excluded, bounds(20)],
    [missingId, bounds(30)],
    [river, bounds(40)],
  ]);
  const computed = [];
  const skipCalls = [];
  const canvasCalls = [];
  const projectedBoundsCache = new Map([
    ["land-a", bounds(100)],
    ["river-a", bounds(200)],
  ]);
  const { owner, state } = createOwnerHarness({
    landFeatures: [land, excluded, missingId],
    riverFeatures: [river],
    computeProjectedFeatureBounds(feature) {
      computed.push(feature);
      return currentBounds.get(feature) || null;
    },
    shouldSkipFeature(feature) {
      skipCalls.push(feature);
      return true;
    },
    getLogicalCanvasDimensions() {
      canvasCalls.push(true);
      return [800, 600];
    },
  });

  owner.rebuildRuntimePrimaryIndex({ projectedBoundsCache });

  assert.deepEqual(computed, [land, excluded, missingId, river]);
  assert.deepEqual(skipCalls, []);
  assert.deepEqual(canvasCalls, []);
  assert.equal(projectedBoundsCache.get("land-a"), currentBounds.get(land));
  assert.equal(projectedBoundsCache.get("land-excluded"), currentBounds.get(excluded));
  assert.equal(projectedBoundsCache.get("feature-2"), currentBounds.get(missingId));
  assert.equal(projectedBoundsCache.get("river-a"), currentBounds.get(river));

  assert.equal(state.landIndex.get("land-a"), land);
  assert.equal(state.landIndex.get("land-excluded"), excluded);
  assert.equal(state.landIndex.get("feature-2"), missingId);
  assert.deepEqual(state.countryToFeatureIds.get("AA"), ["land-a"]);
  assert.deepEqual(state.countryToFeatureIds.get("BB"), ["feature-2"]);
  assert.equal(state.countryToFeatureIds.has("XX"), false);
  assert.equal(state.idToKey.has("land-excluded"), false);
  assert.equal(state.keyToId.has(2), false);
  assert.equal(state.idToKey.get("feature-2"), 3);
});

test("runtime primary rebuild does no bounds or viewport work when no cache accepts bounds", () => {
  const feature = { id: "land-a", countryCode: "AA" };
  const river = { id: "river-a" };
  const { owner, state } = createOwnerHarness({
    landFeatures: [feature],
    riverFeatures: [river],
    computeProjectedFeatureBounds() {
      assert.fail("bounds must not be computed without a writable cache");
    },
    shouldSkipFeature() {
      assert.fail("runtime primary rebuild must not apply viewport skip policy");
    },
    getLogicalCanvasDimensions() {
      assert.fail("runtime primary rebuild must not read viewport dimensions");
    },
  });

  owner.rebuildRuntimePrimaryIndex({ projectedBoundsCache: null });

  assert.equal(state.landIndex.get("land-a"), feature);
  assert.deepEqual(state.countryToFeatureIds.get("AA"), ["land-a"]);
});

test("runtime primary rebuild recomputes bounds each generation and never caches null", () => {
  const feature = { id: "land-a", countryCode: "AA" };
  const projectedBoundsCache = new Map();
  let generation = 0;
  let computeCalls = 0;
  const { owner } = createOwnerHarness({
    landFeatures: [feature],
    computeProjectedFeatureBounds() {
      computeCalls += 1;
      return generation === 0 ? null : bounds(generation * 10);
    },
  });

  owner.rebuildRuntimePrimaryIndex({ projectedBoundsCache });
  assert.equal(projectedBoundsCache.has("land-a"), false);

  generation = 1;
  owner.rebuildRuntimePrimaryIndex({ projectedBoundsCache });
  assert.deepEqual(projectedBoundsCache.get("land-a"), bounds(10));

  generation = 2;
  owner.rebuildRuntimePrimaryIndex({ projectedBoundsCache });
  assert.deepEqual(projectedBoundsCache.get("land-a"), bounds(20));
  assert.equal(computeCalls, 3);
});

test("river bounds are computed once per identified feature and never for a missing id", () => {
  const river = { id: "river-a" };
  const missingId = {};
  const invalidRiver = { id: "river-invalid" };
  const computed = [];
  const riverBounds = bounds(40);
  const projectedBoundsCache = new Map();
  const { owner } = createOwnerHarness({
    riverFeatures: [river, missingId, invalidRiver],
    computeProjectedFeatureBounds(feature) {
      computed.push(feature);
      return feature === river ? riverBounds : null;
    },
  });

  owner.rebuildRuntimePrimaryIndex({ projectedBoundsCache });

  assert.deepEqual(computed, [river, invalidRiver]);
  assert.deepEqual([...projectedBoundsCache], [["river-a", riverBounds]]);
});

test("full spatial build still applies viewport skip policy", () => {
  const visible = { id: "visible", countryCode: "AA", bounds: bounds(10) };
  const skipped = { id: "skipped", countryCode: "BB", bounds: bounds(20) };
  const skipCalls = [];
  const { owner, state } = createOwnerHarness({
    landFeatures: [visible, skipped],
    shouldSkipFeature(feature, width, height, options) {
      skipCalls.push([feature.id, width, height, options]);
      return feature === skipped;
    },
  });

  owner.buildSpatialIndex({ includeSecondary: false });

  assert.deepEqual(skipCalls, [
    ["visible", 800, 600, { forceProd: true }],
    ["skipped", 800, 600, { forceProd: true }],
  ]);
  assert.deepEqual(state.spatialItems.map((item) => item.id), ["visible"]);
});

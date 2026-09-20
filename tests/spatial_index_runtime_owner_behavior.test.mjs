import test from "node:test";
import assert from "node:assert/strict";

import { createSpatialIndexRuntimeOwner } from "../js/core/renderer/spatial_index_runtime_owner.js";
import { createDefaultSpatialIndexState } from "../js/core/state/spatial_index_state.js";
import { collectSpatialItemsForProjectedRects } from "../js/core/renderer/spatial_query_index.js";

function bounds(seed) {
  return {
    minX: seed,
    minY: seed + 1,
    maxX: seed + 2,
    maxY: seed + 3,
    area: seed + 4,
  };
}

test("chunked primary index cancellation at its first yield preserves the existing index", async () => {
  let current = true;
  const { owner, state } = createOwnerHarness({
    landFeatures: [{ id: "late", countryCode: "AA" }],
    yieldToMain: async () => { current = false; },
  });
  const previous = new Map([["previous", { id: "previous" }]]);
  state.featureById = previous;
  assert.equal(await owner.buildIndexChunked({ isCurrent: () => current }), false);
  assert.equal(state.featureById, previous);
  assert.equal(state.featureById.has("late"), false);
});

function createOwnerHarness({
  landFeatures = [],
  riverFeatures = [],
  computeProjectedFeatureBounds = () => null,
  getProjectedFeatureBounds = (feature) => feature?.bounds || null,
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
      getProjectedFeatureBounds,
    },
  });
  return { owner, state };
}

test("explicit geometry delta preserves picking keys and published bounds while order changes", () => {
  const a = { id: "a", countryCode: "AA", bounds: bounds(10) };
  const b = { id: "b", countryCode: "BB", bounds: bounds(30) };
  const reads = [];
  const { owner, state } = createOwnerHarness({ landFeatures: [a, b],
    computeProjectedFeatureBounds: (f) => f.bounds,
    getProjectedFeatureBounds: (f) => { reads.push(f.id); return f.bounds; },
  });
  const cache = new Map();
  owner.rebuildRuntimePrimaryIndex({ projectedBoundsCache: cache });
  const aKey = state.idToKey.get("a"), bKey = state.idToKey.get("b");
  const next = { id: "new", countryCode: "AA", bounds: bounds(60) };
  state.landData = { features: [next, b, a] };
  owner.reconcileRuntimePrimaryIndex({ projectedBoundsCache: cache, incrementalDelta: { changedIds: ["new"], removedIds: [] } });
  assert.deepEqual(reads, ["new"]);
  assert.equal(state.idToKey.get("a"), aKey);
  assert.equal(state.idToKey.get("b"), bKey);
  assert.equal(state.keyToId.get(state.idToKey.get("new")), "new");
  assert.deepEqual(cache.get("a"), a.bounds);
  assert.deepEqual(state.countryToFeatureIds.get("AA"), ["new", "a"]);
  owner.buildSpatialIndex({ includeSecondary: false });
  assert.equal(state.spatialItemsById.get("a").drawOrder, 2);
  const replacement = { ...b, bounds: null, excludedInteraction: true };
  state.landData = { features: [replacement, a] };
  owner.reconcileRuntimePrimaryIndex({ projectedBoundsCache: cache, incrementalDelta: { changedIds: ["b"], removedIds: ["new"] } });
  assert.ok(!cache.has("b") && !cache.has("new"));
  assert.ok(!state.idToKey.has("b") && !state.landIndex.has("new"));
  assert.equal(state.idToKey.get("a"), aKey);
});

test("incremental primary indexes and queried grid match a full rebuild after replacements, reorder, removal and exclusion", () => {
  const a = { id: "a", countryCode: "AA", bounds: bounds(10) };
  const b = { id: "b", countryCode: "BB", bounds: bounds(50) };
  const removed = { id: "gone", countryCode: "AA", bounds: bounds(80) };
  const giant = { id: "world", countryCode: "WW", bounds: { minX: -500, minY: -500, maxX: 2000, maxY: 2000, area: 6250000 } };
  const { state, owner } = createOwnerHarness({ landFeatures: [a, b, removed, giant] });
  owner.rebuildRuntimePrimaryIndex();
  owner.buildSpatialIndex({ includeSecondary: false });
  const unchangedItem = state.spatialItemsById.get("a");
  const originalCountry = state.countryToFeatureIds.get("BB");
  state.landData = { features: [a, b, { id: "new", countryCode: "AA", bounds: bounds(130) }] };
  owner.reconcileRuntimePrimaryIndex();
  owner.buildSpatialIndex({ includeSecondary: false, reuseExisting: true });
  assert.equal(state.spatialItemsById.get("a"), unchangedItem);
  assert.equal(state.countryToFeatureIds.get("BB"), originalCountry);
  assert.ok(!state.landIndex.has("gone") && !state.spatialItemsById.has("world"));

  const nextFeatures = [
    { ...b, countryCode: "CC", excludedInteraction: true, bounds: bounds(180) },
    a,
    { id: "new", countryCode: "AA", excludedVisual: true, bounds: bounds(130) },
    giant,
  ];
  state.landData = { features: nextFeatures };
  owner.reconcileRuntimePrimaryIndex();
  owner.buildSpatialIndex({ includeSecondary: false, reuseExisting: true });
  const full = createOwnerHarness({ landFeatures: nextFeatures });
  full.owner.rebuildRuntimePrimaryIndex();
  full.owner.buildSpatialIndex({ includeSecondary: false });
  for (const key of ["landIndex", "countryToFeatureIds", "idToKey", "keyToId", "spatialItems", "spatialGridMeta", "spatialItemsById"]) {
    assert.deepEqual(state[key], full.state[key], key);
  }
  for (const rect of [{ minX: 0, minY: 0, maxX: 40, maxY: 40 }, { minX: 150, minY: 0, maxX: 500, maxY: 500 }]) {
    const query = (target) => collectSpatialItemsForProjectedRects({ grid: target.spatialGrid, gridMeta: target.spatialGridMeta, items: target.spatialItems, projectedRects: [rect] });
    assert.deepEqual(query(state), query(full.state));
  }
  state.landData = { features: [] };
  owner.reconcileRuntimePrimaryIndex();
  owner.buildSpatialIndex({ includeSecondary: false, reuseExisting: true });
  assert.equal(state.spatialGrid.size, 0);
  assert.equal(state.spatialGridMeta.globals.length, 0);
  assert.equal(state.landIndex.size, 0);
});

test("incremental spatial request rebuilds viewport policy after layout change", () => {
  let width = 800;
  const feature = { id: "a", bounds: bounds(10) };
  const { state, owner } = createOwnerHarness({ landFeatures: [feature], getLogicalCanvasDimensions: () => [width, 600], shouldSkipFeature: () => width < 400 });
  owner.buildSpatialIndex({ includeSecondary: false });
  width = 200;
  owner.buildSpatialIndex({ includeSecondary: false, reuseExisting: true });
  assert.equal(state.spatialItems.length, 0);
});

test("inserting a chunk reuses unchanged spatial geometry while updating picking order", () => {
  const a = { id: "a", bounds: bounds(10) }, b = { id: "b", bounds: bounds(20) };
  const checks = [];
  const { state, owner } = createOwnerHarness({ landFeatures: [a, b], shouldSkipFeature: (feature) => { checks.push(feature.id); return false; } });
  owner.buildSpatialIndex({ includeSecondary: false });
  const original = state.spatialItemsById.get("a");
  checks.length = 0;
  state.landData = { features: [{ id: "new", bounds: bounds(5) }, a, b] };
  owner.buildSpatialIndex({ includeSecondary: false, reuseExisting: true });
  assert.deepEqual(checks, ["new"]);
  assert.deepEqual(state.spatialItems.map((item) => [item.id, item.drawOrder]), [["new", 0], ["a", 1], ["b", 2]]);
  assert.equal(state.spatialItemsById.get("a").minX, original.minX);
  assert.equal(original.drawOrder, 0);
});

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

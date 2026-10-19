import test from "node:test";
import assert from "node:assert/strict";

import { createSpatialIndexRuntimeOwner } from "../js/core/renderer/spatial_index_runtime_owner.js";
import { createDefaultSpatialIndexState } from "../js/core/state/spatial_index_state.js";
import { collectSpatialItemsForProjectedRects } from "../js/core/renderer/spatial_query_index.js";
import { buildSpatialGridSnapshot } from "../js/core/renderer/spatial_index_runtime_builders.js";

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

test("secondary water reuse tracks geometry, flags, removals and projection identity", () => {
  const part = (x) => ({ bounds: bounds(x) });
  let waterA = { id: "a", geometry: { parts: [part(10), part(30)] }, properties: { __source: "scenario" } };
  const waterB = { id: "b", geometry: { parts: [part(50)] } };
  const special = { id: "zone", bounds: bounds(70) };
  let water = [waterA, waterB];
  let specials = [special];
  let identity = "scenario-a:projection-1:water-1";
  let rejected = false;
  let collected = 0;
  let projected = 0;
  const state = createDefaultSpatialIndexState();
  const owner = createSpatialIndexRuntimeOwner({ state, helpers: {
    getFeatureId: (feature) => feature.id,
    getLogicalCanvasDimensions: () => [800, 600],
    getEffectiveWaterRegionFeatures: () => water,
    getEffectiveSpecialRegionFeatures: () => specials,
    getSecondarySpatialCacheIdentity: () => identity,
    collectFeatureHitGeometries: (feature) => { collected += 1; return feature.geometry.parts; },
    shouldExcludeWaterHitGeometry: () => rejected,
    computeProjectedGeoBounds: (geometry) => { projected += 1; return geometry.bounds || null; },
    getProjectedFeatureBounds: (feature) => feature.bounds,
  } });
  const build = () => owner.buildSecondarySpatialIndexes();
  build();
  const firstGrid = state.waterSpatialGrid;
  const firstItem = state.waterSpatialItemsById.get("a::part:0");
  assert.deepEqual([collected, projected], [2, 3]);
  owner.resetSecondarySpatialIndexState({ preserveCurrent: true });
  build();
  assert.equal(state.waterSpatialGrid, firstGrid);
  assert.equal(state.waterSpatialItemsById.get("a::part:0"), firstItem);
  assert.deepEqual([collected, projected], [2, 3]);

  waterA = { ...waterA };
  water = [waterA, waterB];
  build();
  assert.equal(state.waterSpatialItemsById.get("a::part:0").feature, waterA);
  assert.deepEqual([collected, projected], [2, 3]);

  water = [waterB, waterA];
  build();
  assert.deepEqual(state.waterSpatialItems.map((item) => item.id), ["b::part:0", "a::part:0", "a::part:1"]);
  assert.deepEqual(state.waterSpatialGrid,
    buildSpatialGridSnapshot({ items: state.waterSpatialItems, canvasWidth: 800, canvasHeight: 600 }).grid);
  assert.deepEqual([collected, projected], [2, 3]);

  // Two distinct detail subsets must not evict the accepted overview set.
  const coarseGrid = state.waterSpatialGrid;
  const coarseItems = state.waterSpatialItems;
  const detail = { id: "detail", geometry: { parts: [part(90)] } };
  water = [detail];
  build();
  assert.deepEqual([collected, projected], [3, 4]);
  water = [{ id: "other-detail", geometry: { parts: [part(95)] } }];
  build();
  assert.deepEqual([collected, projected], [4, 5]);
  water = [waterB, waterA];
  build();
  assert.equal(state.waterSpatialGrid, coarseGrid);
  assert.deepEqual(state.waterSpatialItems, coarseItems);
  assert.deepEqual([collected, projected], [4, 5]);

  waterA.geometry = { parts: [part(120)] };
  water = [waterA];
  specials = [];
  build();
  assert.deepEqual(state.waterSpatialItems.map((item) => item.id), ["a::part:0"]);
  assert.equal(state.waterSpatialItems[0].minX, 120);
  assert.equal(state.waterSpatialItemsById.has("b::part:0"), false);
  assert.equal(state.specialSpatialItems.length, 0);
  assert.deepEqual([collected, projected], [5, 6]);
  const rect = { minX: 45, minY: 45, maxX: 60, maxY: 60 };
  assert.deepEqual(collectSpatialItemsForProjectedRects({
    grid: state.waterSpatialGrid, gridMeta: state.waterSpatialGridMeta,
    items: state.waterSpatialItems, projectedRects: [rect],
  }).items, []);

  rejected = true;
  identity = "scenario-a:projection-1:water-2";
  build();
  assert.deepEqual(state.waterSpatialItems, []);
  rejected = false;
  identity = "scenario-b:projection-2:water-1";
  waterA.geometry.parts[0].bounds = bounds(240);
  build();
  assert.equal(state.waterSpatialItems[0].minX, 240);
  assert.deepEqual([collected, projected], [7, 7]);
  identity = "scenario-a:projection-1:water-2";
  build();
  assert.equal(state.waterSpatialItems[0].minX, 240);
  assert.deepEqual([collected, projected], [8, 8], "an old identity must not revive a stale snapshot");
});


function createSecondaryChunkHarness({ parts = 1200, constants = {}, fastSource = false } = {}) {
  let water = [{ id: "water", geometry: { parts: Array.from({ length: parts }, (_, index) =>
    ({ bounds: bounds(index % 500) })) }, properties: { __source: "scenario" } }];
  let specials = [{ id: "zone", bounds: bounds(40) }];
  let identity = "scenario:projection:water:1";
  let dimensions = [800, 600];
  let projectionReads = 0;
  let sourceReads = 0;
  let clock = 0;
  const state = createDefaultSpatialIndexState();
  const owner = createSpatialIndexRuntimeOwner({ state, constants, helpers: {
    getFeatureId: (feature) => feature.id,
    getEffectiveWaterRegionFeatures: () => { sourceReads++; return water; },
    getEffectiveSpecialRegionFeatures: () => specials,
    getSecondarySpatialSourceIdentity: fastSource ? () => [water, specials] : undefined,
    getSecondarySpatialCacheIdentity: () => identity,
    getLogicalCanvasDimensions: () => dimensions,
    collectFeatureHitGeometries: (feature) => feature.geometry.parts,
    computeProjectedGeoBounds: (geometry) => { projectionReads += 1; clock += 0.1; return geometry.bounds; },
    getProjectedFeatureBounds: (feature) => feature.bounds,
    nowMs: () => clock,
  } });
  const snapshot = () => Object.fromEntries(Object.entries(state).filter(([key]) =>
    key.startsWith("waterSpatial") || key.startsWith("specialSpatial")));
  return { owner, state, snapshot, get water() { return water; },
    setWater: (next) => { water = next; }, setSpecials: (next) => { specials = next; },
    setIdentity: (next) => { identity = next; }, setDimensions: (next) => { dimensions = next; },
    get projectionReads() { return projectionReads; }, get sourceReads() { return sourceReads; } };
}

test("secondary preparation uses source tokens between slices and full source checks at publication", async () => {
  const h = createSecondaryChunkHarness({ fastSource: true });
  const result = await h.owner.buildSecondarySpatialIndexesChunked();
  assert.equal(result.status, "published");
  assert.ok(result.yieldCount > 10);
  assert.equal(h.sourceReads, 4, "initial capture, initial validation, completed candidate and publication only");
});

test("secondary source tokens still reject in-place feature mutations at publication", async () => {
  const h = createSecondaryChunkHarness({ fastSource: true });
  h.owner.buildSecondarySpatialIndexes();
  const previous = h.snapshot();
  let yields = 0;
  const result = await h.owner.buildSecondarySpatialIndexesChunked({ yieldControl: async () => {
    if (++yields === 2) h.water[0].properties.__source = "changed-in-place";
  } });
  assert.equal(result.status, "cancelled");
  for (const [key, value] of Object.entries(previous)) assert.equal(h.state[key], value, key);
});

test("secondary chunking retains interactive layers and atomically publishes full sync parity", async () => {
  const h = createSecondaryChunkHarness();
  h.owner.buildSecondarySpatialIndexes();
  const previous = h.snapshot();
  const previousContents = Object.fromEntries(Object.entries(previous).map(([key, value]) =>
    [key, value instanceof Map ? new Map([...value].map(([id, bucket]) =>
      [id, Array.isArray(bucket) ? bucket.slice() : bucket]))
      : Array.isArray(value) ? value.slice() : value ? { ...value, globals: value.globals?.slice() } : value]));
  const nextWater = [{ ...h.water[0], geometry: { parts: h.water[0].geometry.parts.slice().reverse() } }];
  h.setWater(nextWater);
  h.setSpecials([{ id: "new-zone", bounds: bounds(100) }]);
  let yields = 0;
  const result = await h.owner.buildSecondarySpatialIndexesChunked({ yieldControl: async () => {
    yields += 1;
    for (const [key, value] of Object.entries(previous)) assert.equal(h.state[key], value, key);
    assert.deepEqual(h.snapshot(), previousContents, "published maps and buckets stay immutable");
    const hits = collectSpatialItemsForProjectedRects({ grid: h.state.waterSpatialGrid,
      gridMeta: h.state.waterSpatialGridMeta, items: h.state.waterSpatialItems,
      projectedRects: [{ minX: 0, minY: 0, maxX: 600, maxY: 600 }] });
    assert.ok(hits.items.length, "old water remains queryable during preparation");
  } });
  assert.equal(result.status, "published");
  assert.equal(result.waterItems, 1200);
  assert.equal(result.specialItems, 1);
  assert.equal(result.yieldCount, yields);
  assert.ok(yields > 10, "a single multipart feature is split across multiple slices");
  assert.ok(result.maxSliceMs < 6.2, "bounds work follows elapsed-time budget");
  assert.notEqual(h.state.waterSpatialGrid, previous.waterSpatialGrid);
  assert.notEqual(h.state.specialSpatialGrid, previous.specialSpatialGrid);
  const published = h.snapshot();
  h.owner.buildSecondarySpatialIndexes();
  assert.deepEqual(h.snapshot(), published, "sync and async snapshots match");
  const reads = h.projectionReads;
  const grid = h.state.waterSpatialGrid;
  const reused = await h.owner.buildSecondarySpatialIndexesChunked();
  assert.equal(reused.status, "published");
  assert.equal(h.projectionReads, reads, "accepted geometry entries reuse bounds");
  assert.equal(h.state.waterSpatialGrid, grid, "exact accepted grid is reused");
});

for (const mutation of ["identity", "layout", "feature", "geometry", "source", "special", "reset", "preserve-reset", "sync", "caller"]) {
  test(`secondary chunking cancels after ${mutation} invalidation without overwriting current state`, async () => {
    const h = createSecondaryChunkHarness();
    h.owner.buildSecondarySpatialIndexes();
    h.setWater([{ ...h.water[0], geometry: { parts: h.water[0].geometry.parts.slice() } }]);
    let expected = h.snapshot();
    let current = true;
    let yields = 0;
    const result = await h.owner.buildSecondarySpatialIndexesChunked({ isCurrent: () => current,
      yieldControl: async () => {
        if (++yields !== 2) return;
        if (mutation === "identity") h.setIdentity("projection:2");
        if (mutation === "layout") h.setDimensions([900, 600]);
        if (mutation === "feature") h.water[0] = { ...h.water[0] };
        if (mutation === "geometry") h.water[0].geometry = { parts: [] };
        if (mutation === "source") h.water[0].properties.__source = "new-source";
        if (mutation === "special") h.setSpecials([]);
        if (mutation === "reset") h.owner.resetSecondarySpatialIndexState();
        if (mutation === "preserve-reset") h.owner.resetSecondarySpatialIndexState({ preserveCurrent: true });
        if (mutation === "sync") h.owner.buildSecondarySpatialIndexes();
        if (mutation === "caller") current = false;
        expected = h.snapshot();
      } });
    assert.equal(result.status, "cancelled");
    assert.equal(yields, 2);
    for (const [key, value] of Object.entries(expected)) assert.equal(h.state[key], value, key);
  });
}

test("a newer secondary async build supersedes a suspended build", async () => {
  const h = createSecondaryChunkHarness();
  let release;
  const suspended = h.owner.buildSecondarySpatialIndexesChunked({
    yieldControl: () => new Promise((resolve) => { release = resolve; }),
  });
  const latest = await h.owner.buildSecondarySpatialIndexesChunked();
  assert.equal(latest.status, "published");
  const snapshot = h.snapshot();
  release();
  assert.equal((await suspended).status, "cancelled");
  assert.deepEqual(h.snapshot(), snapshot);
});

test("secondary grid population yields within a single large cell footprint", async () => {
  const h = createSecondaryChunkHarness({ parts: 1, constants: {
    hitGridTargetCols: 100, hitGridMinCellPx: 1, hitGridMaxCellPx: 10, hitMaxCellsPerItem: 10000,
  } });
  h.water[0].geometry.parts[0].bounds = { minX: 0, minY: 0, maxX: 800, maxY: 600, area: 480000 };
  const result = await h.owner.buildSecondarySpatialIndexesChunked();
  assert.equal(result.status, "published");
  assert.ok(result.yieldCount >= 15, "one grid item spanning thousands of cells is sliced");
  assert.equal(h.state.waterSpatialGrid.size, 7500);
});


test("empty secondary chunked snapshots clear pending state and stale published layers", async () => {
  const h = createSecondaryChunkHarness({ parts: 1 });
  h.owner.buildSecondarySpatialIndexes();
  h.owner.resetSecondarySpatialIndexState({ preserveCurrent: true });
  h.setWater([]);
  h.setSpecials([]);
  const result = await h.owner.buildSecondarySpatialIndexesChunked();
  assert.equal(result.status, "published");
  assert.equal(h.state.secondarySpatialBuildPending, false);
  assert.equal(h.state.waterSpatialItems.length, 0);
  assert.equal(h.state.specialSpatialItems.length, 0);
  assert.equal(h.state.waterSpatialGrid.size, 0);
});

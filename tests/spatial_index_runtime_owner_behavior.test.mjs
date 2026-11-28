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

test("incremental primary indexes and queried grid match a full rebuild after replacements, reorder, removal and exclusion", () => {
  const a = { id: "a", countryCode: "AA", bounds: bounds(10) };
  const b = { id: "b", countryCode: "BB", bounds: bounds(50) };
  const removed = { id: "gone", countryCode: "AA", bounds: bounds(80) };
  const giant = { id: "world", countryCode: "WW", bounds: { minX: -500, minY: -500, maxX: 2000, maxY: 2000, area: 6250000 } };
  const { state, owner } = createOwnerHarness({ landFeatures: [a, b, removed, giant] });
  owner.rebuildRuntimePrimaryIndex();
  owner.buildSpatialIndex({ includeSecondary: false });
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
  for (const rect of [{ minX: 0, minY: 0, maxX: 40, maxY: 40 }, { minX: 150, minY: 0, maxX: 500, maxY: 500 }]) {
    const query = (target) => collectSpatialItemsForProjectedRects({ grid: target.spatialGrid, gridMeta: target.spatialGridMeta, items: target.spatialItems, projectedRects: [rect] });
    assert.deepEqual(query(state), query(full.state));
  }
});

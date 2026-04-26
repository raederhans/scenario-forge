import test from "node:test";
import assert from "node:assert/strict";

import {
  createDefaultProjectedBoundsCacheState,
  createDefaultRenderPassCacheState,
  createDefaultRendererTransientRuntimeState,
  createDefaultSidebarPerfState,
  ensureRenderPassCacheState,
  ensureSidebarPerfState,
  ensureSphericalFeatureDiagnosticsCache,
  resetProjectedBoundsCacheState,
  setInteractionInfrastructureStateFields,
} from "../js/core/state/renderer_runtime_state.js";
import {
  createDefaultSpatialIndexState,
} from "../js/core/state/spatial_index_state.js";
import {
  createDefaultBorderCacheState,
} from "../js/core/state/border_cache_state.js";
import {
  applyPrimarySpatialSnapshot,
  applySecondarySpatialSnapshot,
  clearPrimaryIndexMaps,
  resetPrimarySpatialState,
  resetSecondarySpatialState,
} from "../js/core/renderer/spatial_index_runtime_state_ops.js";
import {
  createSpatialIndexPerfPayload,
  deriveRuntimePrimaryFeaturePayload,
} from "../js/core/renderer/spatial_index_runtime_derivation.js";

test("renderer runtime factories return fresh nested caches", () => {
  const first = createDefaultRendererTransientRuntimeState();
  const second = createDefaultRendererTransientRuntimeState();

  first.renderPassCache.counters.frames = 9;
  first.renderPassCache.partialPoliticalDirtyIds.add("feature-1");
  first.sidebarPerf.counters.legendRenders = 2;
  first.projectedBoundsById.set("feature-1", { minX: 1 });
  first.sphericalFeatureDiagnosticsById.set("feature-1", { total: 1 });

  assert.equal(second.renderPassCache.counters.frames, 0);
  assert.equal(second.renderPassCache.partialPoliticalDirtyIds.size, 0);
  assert.equal(second.sidebarPerf.counters.legendRenders, 0);
  assert.equal(second.projectedBoundsById.size, 0);
  assert.equal(second.sphericalFeatureDiagnosticsById.size, 0);
});

test("renderer supporting factories keep cache shapes aligned", () => {
  const renderPass = createDefaultRenderPassCacheState();
  const sidebarPerf = createDefaultSidebarPerfState();
  const projectedBounds = createDefaultProjectedBoundsCacheState();
  const borderCache = createDefaultBorderCacheState();
  const spatialIndex = createDefaultSpatialIndexState();

  assert.equal(renderPass.lastGoodFrame.valid, false);
  assert.equal(renderPass.compositeBuffer.canvas, null);
  assert.equal(renderPass.interactionComposite.scenarioId, "");
  assert.equal(renderPass.interactionComposite.topologyRevision, 0);
  assert.equal(renderPass.interactionComposite.pixelWidth, 0);
  assert.equal(renderPass.counters.missingVisibleFrameSkippedDuringInteraction, 0);
  assert.equal(createDefaultRendererTransientRuntimeState().firstVisibleFramePainted, false);
  assert.equal(sidebarPerf.counters.fullListRenders, 0);
  assert.equal(projectedBounds.projectedBoundsById.size, 0);
  assert.equal(borderCache.cachedFrontlineMeshHash, "");
  assert.equal(borderCache.cachedParentBordersByCountry.size, 0);
  assert.equal(spatialIndex.landIndex.size, 0);
  assert.equal(spatialIndex.waterSpatialItems.length, 0);
  assert.equal(spatialIndex.specialSpatialGrid.size, 0);
});

test("renderer runtime accessors normalize cache and infra holders in place", () => {
  const state = {
    renderPassCache: {
      counters: { frames: 3 },
      dirty: {},
      reasons: {},
    },
    sidebarPerf: {},
  };

  const renderPassCache = ensureRenderPassCacheState(state, {
    cloneZoomTransform(value) {
      return value ? { ...value } : value;
    },
    renderPassNames: ["background", "political"],
  });
  const sidebarPerf = ensureSidebarPerfState(state);
  resetProjectedBoundsCacheState(state);
  const diagnostics = ensureSphericalFeatureDiagnosticsCache(state);
  const stage = setInteractionInfrastructureStateFields(state, "basic-ready", {
    ready: true,
    inFlight: false,
  });

  assert.equal(renderPassCache.counters.frames, 3);
  assert.equal(renderPassCache.compositeBuffer.canvas, null);
  assert.equal(renderPassCache.dirty.background, true);
  assert.equal(renderPassCache.reasons.political, "init");
  assert.equal(sidebarPerf.counters.legendRenders, 0);
  assert.equal(state.projectedBoundsById.size, 0);
  assert.equal(diagnostics.size, 0);
  assert.equal(stage, "basic-ready");
  assert.equal(state.interactionInfrastructureReady, true);
  assert.equal(state.interactionInfrastructureBuildInFlight, false);
});

test("spatial state ops preserve snapshot shapes across reset and apply", () => {
  const state = createDefaultSpatialIndexState();
  const landIndexRef = state.landIndex;
  const countryToFeatureIdsRef = state.countryToFeatureIds;
  const idToKeyRef = state.idToKey;
  const keyToIdRef = state.keyToId;

  state.landIndex.set("a", {});
  state.countryToFeatureIds.set("AA", ["a"]);
  state.idToKey.set("a", 1);
  state.keyToId.set(1, "a");
  state.spatialItems = [{ id: "a" }];
  state.waterSpatialItems = [{ id: "water" }];
  state.specialSpatialItems = [{ id: "special" }];

  clearPrimaryIndexMaps(state);
  resetPrimarySpatialState(state);
  resetSecondarySpatialState(state);

  assert.equal(state.landIndex, landIndexRef);
  assert.equal(state.countryToFeatureIds, countryToFeatureIdsRef);
  assert.equal(state.idToKey, idToKeyRef);
  assert.equal(state.keyToId, keyToIdRef);
  assert.equal(state.landIndex.size, 0);
  assert.equal(state.countryToFeatureIds.size, 0);
  assert.equal(state.idToKey.size, 0);
  assert.equal(state.keyToId.size, 0);
  assert.equal(state.spatialItems.length, 0);
  assert.equal(state.waterSpatialItems.length, 0);
  assert.equal(state.specialSpatialItems.length, 0);

  const primaryItems = [{ id: "next" }];
  const primaryGrid = new Map([["grid", [1]]]);
  const primaryItemsById = new Map([["next", primaryItems[0]]]);
  const waterItems = [{ id: "water-next" }];
  const waterGrid = new Map([["water", [1]]]);
  const waterItemsById = new Map([["water-next", waterItems[0]]]);
  const specialItems = [{ id: "special-next" }];
  const specialGrid = new Map([["special", [1]]]);
  const specialItemsById = new Map([["special-next", specialItems[0]]]);

  applyPrimarySpatialSnapshot(state, {
    items: primaryItems,
    grid: primaryGrid,
    gridMeta: { cols: 2 },
    itemsById: primaryItemsById,
  });
  applySecondarySpatialSnapshot(state, {
    water: {
      items: waterItems,
      grid: waterGrid,
      gridMeta: { cols: 1 },
      itemsById: waterItemsById,
    },
    special: {
      items: specialItems,
      grid: specialGrid,
      gridMeta: { cols: 3 },
      itemsById: specialItemsById,
    },
  });

  assert.equal(state.spatialItems, primaryItems);
  assert.equal(state.spatialGrid, primaryGrid);
  assert.deepEqual(state.spatialGridMeta, { cols: 2 });
  assert.equal(state.spatialItemsById, primaryItemsById);
  assert.equal(state.spatialIndex, null);
  assert.equal(state.waterSpatialItems, waterItems);
  assert.equal(state.waterSpatialGrid, waterGrid);
  assert.deepEqual(state.waterSpatialGridMeta, { cols: 1 });
  assert.equal(state.waterSpatialItemsById, waterItemsById);
  assert.equal(state.waterSpatialIndex, null);
  assert.equal(state.specialSpatialItems, specialItems);
  assert.equal(state.specialSpatialGrid, specialGrid);
  assert.deepEqual(state.specialSpatialGridMeta, { cols: 3 });
  assert.equal(state.specialSpatialItemsById, specialItemsById);
  assert.equal(state.specialSpatialIndex, null);
});

test("spatial derivation payloads stay pure and explicit", () => {
  const projectedBoundsCache = new Map();
  const payload = deriveRuntimePrimaryFeaturePayload({
    feature: { id: "feature-1" },
    id: "feature-1",
    canvasWidth: 100,
    canvasHeight: 100,
    projectedBoundsCache,
    computeProjectedFeatureBounds: () => ({ minX: 1, minY: 2, maxX: 3, maxY: 4 }),
    shouldSkipFeature: () => false,
    getResolvedFeatureColor: () => "#123456",
  });
  const perfPayload = createSpatialIndexPerfPayload({
    landCount: 10,
    spatialItems: 8,
    waterItems: 2,
    specialItems: 1,
    skipped: false,
    chunked: true,
  });

  assert.deepEqual(payload, {
    bounds: { minX: 1, minY: 2, maxX: 3, maxY: 4 },
    resolvedColor: "#123456",
    skipped: false,
  });
  assert.deepEqual(projectedBoundsCache.get("feature-1"), { minX: 1, minY: 2, maxX: 3, maxY: 4 });
  assert.deepEqual(perfPayload, {
    landCount: 10,
    spatialItems: 8,
    waterItems: 2,
    specialItems: 1,
    skipped: false,
    chunked: true,
  });
});

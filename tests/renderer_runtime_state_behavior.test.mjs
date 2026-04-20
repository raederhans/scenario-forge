import test from "node:test";
import assert from "node:assert/strict";

import {
  createDefaultProjectedBoundsCacheState,
  createDefaultRenderPassCacheState,
  createDefaultRendererTransientRuntimeState,
  createDefaultSidebarPerfState,
} from "../js/core/state/renderer_runtime_state.js";
import {
  createDefaultSpatialIndexState,
} from "../js/core/state/spatial_index_state.js";
import {
  createDefaultBorderCacheState,
} from "../js/core/state/border_cache_state.js";

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
  assert.equal(sidebarPerf.counters.fullListRenders, 0);
  assert.equal(projectedBounds.projectedBoundsById.size, 0);
  assert.equal(borderCache.cachedFrontlineMeshHash, "");
  assert.equal(borderCache.cachedParentBordersByCountry.size, 0);
  assert.equal(spatialIndex.landIndex.size, 0);
  assert.equal(spatialIndex.waterSpatialItems.length, 0);
  assert.equal(spatialIndex.specialSpatialGrid.size, 0);
});

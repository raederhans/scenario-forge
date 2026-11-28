import assert from "node:assert/strict";
import test from "node:test";
import { createRenderCacheOwner } from "../js/core/renderer/render_cache_owner.js";
import {
  INTERACTION_COMPOSITE_PASS_NAMES,
  RENDER_PASS_NAMES,
} from "../js/core/map_renderer/render_pass_catalog.js";

function cloneZoomTransform(transform) {
  return transform && typeof transform === "object" ? { ...transform } : transform;
}

function createRenderPassCache() {
  return {
    layouts: {}, signatures: {}, dirty: {}, interactionComposite: { valid: true, scenarioId: "base",
      sceneGeneration: 2, scenarioDataGeneration: 3, selectionVersion: 1,
      topologyRevision: 4, colorRevision: 5, contextFlagSignature: "flags" },
  };
}

function createSurfaceOwner(cache) {
  const state = { renderPassCache: cache, width: 20, height: 10, dpr: 1 };
  const owner = createRenderCacheOwner({
    state,
    constants: {
      renderPassNames: RENDER_PASS_NAMES,
      interactionCompositePassNames: INTERACTION_COMPOSITE_PASS_NAMES,
    },
    getters: {
      getContext: () => ({ canvas: { width: state.width, height: state.height } }),
    },
    helpers: {
      ensureRenderPassCacheState: (target) => target.renderPassCache,
      cloneZoomTransform,
      getTransformSignature: (transform) => JSON.stringify(transform),
      getVisibleFrameIdentity: () => ({
        scenarioId: "base", sceneGeneration: 2, scenarioDataGeneration: 3, selectionVersion: 1,
        contextFlagSignature: "flags", topologyRevision: 4, colorRevision: 5, dpr: 1,
        pixelWidth: state.width, pixelHeight: state.height,
      }),
      areZoomTransformsEquivalent: (left, right) => JSON.stringify(left) === JSON.stringify(right),
    },
  });
  return owner;
}

test("zero-sized composite backings cannot claim explicit viewport coverage", () => {
  const transform = { x: 0, y: 0, k: 1 };
  const cache = createRenderPassCache();
  const owner = createSurfaceOwner(cache);
  Object.assign(cache.interactionComposite, {
    canvas: { width: 0, height: 0 },
    coverage: { minX: 0, minY: 0, maxX: 20, maxY: 10 },
    referenceTransform: transform, dpr: 1, pixelWidth: 20, pixelHeight: 10,
  });
  cache.interactionComposite.signature = owner.getInteractionCompositeSignature();
  assert.equal(owner.canDrawInteractionComposite(transform), false);
  assert.equal(cache.interactionComposite.reason, "coverage-mismatch");
});

test("explicit paint padding covers pans through 96 CSS pixels and requires refill beyond", async () => {
  const { getSurfaceCoverage, transformCoverage, coversViewport } = await import("../js/core/renderer/cached_surface_coverage.js");
  let direct = false;
  const state = { width: 800, height: 600, dpr: 2, renderPassCache: createRenderPassCache() };
  const owner = createRenderCacheOwner({ state,
    getters: { getPassPaintOverscanPx: () => direct ? 96 : 0 },
    helpers: { ensureRenderPassCacheState: () => state.renderPassCache } });
  assert.equal(owner.getRenderPassLayout("labels").offsetX, 0);
  direct = true;
  const layout = owner.getRenderPassLayout("labels");
  assert.deepEqual([layout.offsetX, layout.offsetY, layout.pixelWidth, layout.pixelHeight], [96, 96, 1984, 1584]);
  const coverage = getSurfaceCoverage({ width: layout.pixelWidth, height: layout.pixelHeight }, layout);
  const reference = { x: 0, y: 0, k: 1 };
  for (const x of [-96, -48, 0, 48, 96]) assert.equal(coversViewport(transformCoverage(coverage, reference, { x, y: 0, k: 1 }), 800, 600), true);
  assert.equal(coversViewport(transformCoverage(coverage, reference, { x: 97, y: 0, k: 1 }), 800, 600), false);
  assert.equal(coversViewport(transformCoverage(coverage, { x: 97, y: 0, k: 1 }, { x: 97, y: 0, k: 1 }), 800, 600), true);
  direct = false;
  assert.equal(owner.getRenderPassLayout("labels").offsetX, 0);
  assert.deepEqual([state.width, state.height], [800, 600]);
});

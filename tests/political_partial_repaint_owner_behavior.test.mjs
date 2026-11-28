import assert from "node:assert/strict";
import test from "node:test";

import { createPoliticalPartialRepaintOwner } from "../js/core/renderer/political_partial_repaint_owner.js";
import { isPoliticalFeaturePathEntryCurrent } from "../js/core/renderer/political_path_cache_owner.js";
import { createPoliticalFeaturePolicy } from "../js/core/renderer/political_feature_policy.js";

function createHarness(overrides = {}) {
  const events = [];
  const transform = { x: 0, y: 0, k: 1 };
  const feature = { id: "land-1", geometry: { type: "Polygon", coordinates: [] } };
  const cache = {
    partialPoliticalDirtyIds: new Set(["land-1"]),
    canvases: {},
    signatures: { political: "static" },
    dirty: { political: true },
    reasons: { political: "refresh-colors" },
  };
  const context = {
    canvas: { width: 100, height: 100 },
    save: () => events.push("context:save"),
    restore: () => events.push("context:restore"),
    setTransform() {}, beginPath() {}, rect() {}, clip() {}, clearRect() {}, translate() {}, scale() {}, stroke() {},
    fill: (value) => events.push(["fill", value]),
  };
  cache.canvases.political = { width: 100, height: 100, getContext: () => context };
  const state = {
    width: 100,
    height: 100,
    dpr: 1,
    renderPhase: "idle",
    deferExactAfterSettle: false,
    activeScenarioId: "scenario-a",
    colors: { "land-1": "#123456" },
    landData: { features: [feature] },
    landIndex: new Map([["land-1", feature]]),
  };
  const path = { kind: "path" };
  const helpers = {
    nowMs: () => 10,
    getFeatureId: (candidate) => candidate?.id || "",
    isAtlantropaSeaFeature: () => false,
    getAtlantropaSeaPoliticalFillColor: () => "#001122",
    getAtlantropaSeaPoliticalStrokeColor: () => "#112233",
    getSafeCanvasColor: (value, fallback) => value || fallback,
    getResolvedFeatureColor: () => "#654321",
    hashToColor: () => "#abcdef",
    buildWorkerPixelRingsForGeometry: () => [[[1, 2], [3, 4], [1, 2]]],
    projectCoordinateToWorkerPixel() {},
    orderPoliticalShellUnderlayFirst: (items) => [...items],
    shouldExcludePoliticalVisualFeature: () => false,
    shouldSkipFeature: () => false,
    pathBoundsInScreen: () => true,
    getPoliticalFeaturePathEntry: (candidate) => ({ path, geometryRef: candidate.geometry }),
    isPoliticalFeaturePathEntryCurrent,
    rectsIntersect: (a, b) => !(a.maxX < b.minX || a.maxY < b.minY || a.minX > b.maxX || a.minY > b.maxY),
    screenRectToProjectedRect: (rect) => ({ ...rect }),
    collectLandSpatialItemsForProjectedRects: () => ({
      overflow: false,
      items: [{ id: "land-1", feature, drawOrder: 0 }],
    }),
    getFeatureScreenBounds: () => ({ minX: 5, minY: 5, maxX: 15, maxY: 15, x: 5, y: 5, width: 10, height: 10 }),
    getRenderPassLayout: () => ({ pixelWidth: 100, pixelHeight: 100, paddedWidth: 100, paddedHeight: 100, offsetX: 0, offsetY: 0 }),
    getPassReferenceTransform: () => transform,
    areZoomTransformsEquivalent: (left, right) => left === right,
    hasPassFullReferenceTransform: () => true,
    getPassFullReferenceTransform: () => transform,
    getPoliticalPassFineBaselineMismatch: () => "",
    getCachedPoliticalPassStaticSignature: () => "static",
    getPoliticalPathCacheHandle: () => ({ valid: true, map: new Map([["land-1", { path, geometryRef: feature.geometry }]]) }),
    getRetainedPoliticalBackgroundPathHandle: () => null,
    getVisibleFrameIdentity: () => ({}),
    createPoliticalRasterWorkerIdentity: (value) => ({ protocolVersion: 4, ...value }),
    getLogicalCanvasDimensions: () => [100, 80],
    getRenderPassSignature: () => "pass-signature",
    getPoliticalPassViewportOverscanPx: () => 12,
    collectVisibleLandSpatialItemsWithStats: () => ({ items: [{ id: "land-1", feature, drawOrder: 0 }], stats: { candidateCount: 1 } }),
    cloneZoomTransform: (value) => ({ ...value }),
    getTransformBucketSignature: () => "bucket-a",
    getIslandNeighborGraph: () => null,
    ensurePoliticalRasterWorkerMetrics: () => ({}),
    ...overrides.helpers,
  };
  const effects = {
    incrementPerfCounter() {}, recordRenderPerfMetric() {},
    drawPoliticalBackgroundFillsForEntries: () => 1,
    withRenderTarget: (_target, callback) => callback(),
    clearPendingPoliticalColorEdit() {}, setPassReferenceTransform() {}, recordPassTiming() {},
    commitPoliticalPassDiagnostics() {}, requestPoliticalRasterWorkerPass() {}, onAcceptedBitmapResult() {},
    ...overrides.effects,
  };
  const owner = createPoliticalPartialRepaintOwner({
    surface: {
      getContext: () => context,
      getProjection: () => (point) => point,
      getPathCanvas: () => () => {},
    },
    getters: {
      getRuntimeState: () => state,
      getDebugMode: () => "PROD",
      getDefaultTransform: () => transform,
      getRenderPassCacheState: () => cache,
      ...overrides.getters,
    },
    helpers,
    effects,
  });
  return { owner, state, cache, context, events, feature, transform };
}

test("inline river partial loops replay intersecting parent units in global source order", () => {
  let h;
  let policy;
  const candidates = [];
  const paths = new Map();
  h = createHarness({
    getters: {
      hasInlinePoliticalPartitions: () => true,

    },
    helpers: {
      orderPoliticalShellUnderlayFirst: (entries) => policy.orderPoliticalShellUnderlayFirst(entries),
      collectLandSpatialItemsForProjectedRects: () => ({ items: candidates, overflow: false }),
      getPoliticalPathCacheHandle: () => ({ valid: true, map: paths }),
      shouldExcludePoliticalVisualFeature: (feature) => feature.hidden === true,
    },
    effects: { drawPartitionForParent: (feature, k) => {
      h.events.push(["cells", feature.id, k], ["contour", feature.id, k]);
    } },
  });
  const lower = h.feature;
  const upper = { id: "upper", geometry: {} };
  const third = { id: "third", geometry: {} };
  const underlay = { id: "primary", properties: { __source: "primary" }, geometry: {} };
  const hidden = { id: "hidden", geometry: {}, hidden: true };
  h.state.landData.features = [lower, underlay, upper, hidden, third];
  h.state.visualOverrides = { "land-1": "#ff0000" };
  for (const [drawOrder, feature] of h.state.landData.features.entries()) {
    h.state.landIndex.set(feature.id, feature);
    paths.set(feature.id, { path: { id: feature.id }, geometryRef: feature.geometry });
    candidates.unshift({ id: feature.id, feature, drawOrder });
  }
  policy = createPoliticalFeaturePolicy(h.state, {
    getFeatureId: (feature) => feature?.id || "",
    getSafeCanvasColor: (color, fallback) => color || fallback,
    hasPendingPoliticalColorEdit: () => true,
    getRenderPassCacheState: () => ({ pendingPoliticalColorEditIds: new Set(["land-1"]) }),
    isStablePaintOrderEnabled: () => true,
  });
  const units = () => h.events.filter((event) => Array.isArray(event)
    && ["fill", "cells", "contour"].includes(event[0]))
    .map(([kind, value]) => `${kind}:${value?.id || value}`);
  const expected = ["primary", "land-1", "upper", "third"]
    .flatMap((id) => [`fill:${id}`, `cells:${id}`, `contour:${id}`]);
  assert.equal(h.owner.tryPartialPoliticalPassRepaint(h.transform, "next", {}), true);
  assert.deepEqual(units(), expected, "a dirty lower face replays every upper face that intersects its dirty area");
});

test("partial draw exceptions restore canvas and preserve fallback state", () => {
  const { owner, cache, context, events, transform } = createHarness();
  context.fill = () => { throw new Error("fine-draw-failed"); };
  assert.equal(owner.tryPartialPoliticalPassRepaint(transform, "next", {}), false);
  assert.equal(events.filter((entry) => entry === "context:save").length, 1);
  assert.equal(events.filter((entry) => entry === "context:restore").length, 1);
  assert.equal(cache.signatures.political, "static");
  assert.equal(cache.dirty.political, true);
  assert.deepEqual([...cache.partialPoliticalDirtyIds], ["land-1"]);
  assert.equal(cache.reasons.political, "refresh-colors");
});

import assert from "node:assert/strict";
import test from "node:test";
import { createRuntimeResourceBudget } from "../js/core/runtime_resource_budget.js";

import { createPoliticalBackgroundRenderOwner } from "../js/core/renderer/political_background_render_owner.js";
import { isPoliticalFeaturePathEntryCurrent } from "../js/core/renderer/political_path_cache_owner.js";

import { getProjectedPathResourceAccounting } from "../js/core/renderer/projected_path_resource_accounting.js";

class FakePath2D { addPath() {} }

function createFixture({ progressiveLimit = 2400 } = {}) {
  const calls = [];
  const pending = [];
  const pathCache = new Map();
  const renderCache = { dirty: {}, reasons: {} };
  const state = {
    activeScenarioId: "scenario-a",
    landData: { features: [] },
    colors: {},
    zoomTransform: { k: 1, x: 0, y: 0 },
    sceneGeneration: 10,
    scenarioDataGeneration: 20,
    renderPhase: "idle",
  };
  const context = {
    canvas: { width: 800, height: 400 },
    beginPath() {}, fill() {}, save() {}, restore() {},
  };
  const surface = {
    getContext: () => context,
    getPathCanvas: () => () => {},
    getProjection: () => (point) => point,
  };
  const helpers = {
    getAtlantropaSeaPoliticalFillColor: () => "#004466",
    getFeatureId: (feature) => String(feature?.properties?.id || ""),
    getSafeCanvasColor: (value, fallback) => value || fallback,
    isAtlantropaSeaFeature: () => false,
    getResolvedFeatureColor: () => "#778899",
    getDisplayOwnerCode: feature => feature.properties.owner,
    getFeatureCountryCodeNormalized: (feature) => feature?.properties?.country || "AA",
    isWorldBounds: () => false,
    getPoliticalPathCacheHandle: () => ({ valid: true, map: pathCache }),
    getPoliticalFeaturePathEntry: (feature, { featureId }) => {
      if (!isPoliticalFeaturePathEntryCurrent(pathCache.get(featureId), feature)) {
        pathCache.set(featureId, { path: { featureId }, geometryRef: feature.geometry });
      }
      return pathCache.get(featureId);
    },
    isPoliticalFeaturePathEntryCurrent,
    getTransformSignature: (transform) => `transform:${transform.k}:${transform.x}:${transform.y}`,
    // Production path identity tracks projection/topology roots, not chunk membership.
    getPoliticalPathCacheSignature: () => `path:${state.activeScenarioId}:${state.sceneGeneration}:${state.projectionRevision || 0}:${state.topologyRevision || 0}`,
    getVisibleFrameIdentity: () => ({
      scenarioId: state.activeScenarioId,
      sceneGeneration: state.sceneGeneration,
      scenarioDataGeneration: state.scenarioDataGeneration,
    }),
    nowMs: (() => { let now = 0; return () => ++now; })(),
    getRenderPassCacheState: () => renderCache,
    isInteractionRecoverySettled: () => true,
    isExactAfterSettleControllerActive: () => false,
    cloneZoomTransform: (transform) => ({ ...transform }),
    getLogicalCanvasDimensions: () => [800, 400],
    isAntarcticSectorFeature: () => false,
    isBaseGeographyScenarioFeature: () => false,
    shouldExcludePoliticalVisualFeature: () => false,
    shouldSkipFeature: () => false,
    getProjectedFeatureBounds: () => ({ minX: 0, minY: 0, maxX: 1, maxY: 1 }),
    collectVisibleLandSpatialItems: () => [],
    screenRectToProjectedRect: (rect) => rect,
    collectLandSpatialItemsForProjectedRects: () => ({ items: [], overflow: false }),
    projectedBoundsIntersectScreenRects: () => true,
    getPoliticalRecoveryQuality: () => "progressive",
    hasPendingPoliticalColorEdit: () => false,
    getAdmin0BackgroundFillColor: (code) => `color:${code}`,
    normalizeIntensityFieldsState: (value) => ({ ...value, normalized: true }),
    getRenderPassLayout: () => ({ pixelWidth: 800, pixelHeight: 400, dpr: 1 }),
    getProjectionRenderSignature: () => `projection-${state.projectionRevision || 0}`,
    getOceanBaseFillColor: () => "#001122",
  };
  const resourceBudget = createRuntimeResourceBudget();
  const effects = {
    recordRenderPerfMetric() {}, cancelDeferredWork() {},
    scheduleDeferredWork: (callback) => {
      const handle = { callback };
      pending.push(handle);
      return handle;
    },
    invalidateRenderPasses() {}, recordProgressivePoliticalFullCacheReadyDiagnostics() {},
    requestRendererRender: () => calls.push("repaint"), renderFallback() {},
    commitIntensityFieldsState() {}, getIntensityFieldMaskOwner() {},
    applyOceanClipMask() {}, drawOceanStyle() {}, warn() {},
    resourceBudget, politicalPathResourceAccounting: getProjectedPathResourceAccounting(resourceBudget),
  };
  const owner = createPoliticalBackgroundRenderOwner({
    surface,
    getters: { getRuntimeState: () => state, getDebugMode: () => "PROD" },
    helpers,
    effects,
    platform: {
      d3: { zoomIdentity: { k: 1, x: 0, y: 0 } },
      Path2D: FakePath2D,
    },
    constants: { progressiveBackgroundExactEntryLimit: progressiveLimit },
  });
  return { owner, state, calls, pending };
}

function feature(id, owner = "AA") {
  return { type: "Feature", properties: { id, owner, country: owner }, geometry: { type: "Polygon" } };
}


test("retained index distinguishes duplicate feature IDs by geometry", () => {
  const fixture = createFixture();
  const first = feature("same");
  const second = feature("same");
  fixture.state.landData = { features: [first, second] };
  fixture.owner.drawPoliticalBackgroundFillsForEntries([
    { feature: first, id: "same" }, { feature: second, id: "same" },
  ], { useFullPassCache: true, returnSummary: true });
  const handle = fixture.owner.getRetainedPoliticalBackgroundPathHandle();
  assert.ok(handle.getPath(first, "same"));
  assert.ok(handle.getPath(second, "same"));
  assert.notEqual(handle.getPath(first, "same"), handle.getPath(second, "same"));
});

test("recolor regroups warm paths", () => {
  const fixture = createFixture();
  const entries = ["a", "b"].map((id) => ({ feature: feature(id), id }));
  fixture.state.landData = { features: entries.map((entry) => entry.feature) };
  const draw = () => fixture.owner.drawPoliticalBackgroundFillsForEntries(entries, {
    useFullPassCache: true, returnSummary: true,
  });
  draw();
  fixture.state.colors.a = "#ff0000";
  const summary = draw();
  assert.equal(summary.groupCount, 2);
});

test("deferred geometry replacement cancels before publishing retained paths", () => {
  const fixture = createFixture({ progressiveLimit: 1 });
  fixture.state.landData = { features: [feature("a"), feature("b")] };
  const visibleItems = fixture.state.landData.features.map((item, drawOrder) => ({
    id: item.properties.id, feature: item, drawOrder, minX: 0, minY: 0, maxX: 1, maxY: 1,
  }));
  fixture.owner.drawPoliticalBackgroundFills({ visibleItems, returnSummary: true });
  fixture.pending.shift().callback({ timeRemaining: () => 0 });
  fixture.state.landData.features[0].geometry = { type: "Polygon" };
  for (let index = 0; fixture.pending.length && index < 100; index++) fixture.pending.shift().callback();
  assert.equal(fixture.pending.length, 0);
  assert.equal(fixture.calls.includes("repaint"), false);
});

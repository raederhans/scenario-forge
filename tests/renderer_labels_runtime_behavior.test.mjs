import test from "node:test";
import assert from "node:assert/strict";
import { createLabelsRuntime } from "../js/core/map_renderer/labels_runtime.js";
import { getMapLabelHierarchy } from "../js/core/renderer/map_label_hierarchy.js";

function createHarness(overrides = {}) {
  const state = {
    width: 800, height: 600, showCityPoints: true,
    worldCitiesData: { type: "FeatureCollection", features: [] },
    zoomTransform: { x: 0, y: 0, k: 2 },
    styleConfig: { cityPoints: {}, countryLabels: { enabled: false } },
    ...overrides,
  };
  const renders = [];
  const metrics = [];
  const projection = ([x, y]) => [x, y];
  projection.stream = sink => sink;
  const runtime = createLabelsRuntime({
    runtimeState: state,
    rendererSurfaceHost: {
      getContext: () => null,
      getProjection: () => projection,
      getMapSvg: () => null,
      getPathCanvas: () => null,
    },
    TEXTURE_LABEL_SERIF_STACK: "serif",
    clamp: (value, min, max) => Math.max(min, Math.min(max, value)),
    normalizeLongitude: value => value,
    getDisplayOwnerCode: () => "",
    resolveBorderIdentity: id => state.scenarioBaselineOwnersByFeatureId?.[id],
    getSignedHashUnit: () => 0,
    getLabelPaintBounds: () => null,
    getLabelPaintOverscanPx: () => 0,
    getFeatureCollectionFeatureCount: collection => collection?.features?.length || 0,
    isExportRenderInProgress: () => false,
    isPrivateSceneActive: () => true,
    invalidateRenderPasses: () => {},
    requestRendererRender: reason => renders.push(reason),
    nowMs: () => 0,
    collectContextMetric: (name, elapsed, detail) => metrics.push({ name, detail }),
    recordRenderPerfMetric: () => {},
    recordInteractionDurationMetric: () => {},
    drawPendingTransportLabels: () => {},
    drawPhysicalRegionLabels: () => {},
  });
  return { runtime, state, renders, metrics };
}

test("label priority survives zoom oscillation and switches on monotonic boundary crossings", () => {
  const { runtime, state } = createHarness({
    styleConfig: { cityPoints: {}, countryLabels: { enabled: true } },
  });
  for (const [scales, expected] of [
    [[1, 2.85, 2.95, 3.05, 2.95, 3.05, 3.149], true],
    [[3.15, 4, 6, 3.05, 2.95, 3.05, 2.95, 2.851], false],
    [[2.85, 2.5, 1], true],
  ]) {
    for (const k of scales) {
      const hierarchy = runtime.drawLabelsPassContent(k);
      assert.equal(hierarchy.preferCountries, expected);
      assert.deepEqual(hierarchy, { ...getMapLabelHierarchy(k, state), preferCountries: expected });
      if (k < 2.85 || k > 3.15) {
        assert.deepEqual(hierarchy, getMapLabelHierarchy(k, state));
      }
    }
  }
});

test("reset cancels old city preparation after scene and data replacement", async () => {
  const { runtime, state, renders, metrics } = createHarness({
    worldCitiesData: { type: "FeatureCollection", features: [{ type: "Feature", id: "first",
      properties: { name: "First", __city_id: "first" },
      geometry: { type: "Point", coordinates: [100, 100] } }] },
  });
  assert.equal(await runtime.prepareCityPointsPass(), true);
  const published = runtime.getCachedEffectiveCityCollection();
  state.worldCitiesData = { type: "FeatureCollection", features: [] };
  state.activeScenarioId = "replacement";
  state.sceneGeneration = 1;
  const pending = runtime.prepareCityPointsPass();
  assert.ok(pending instanceof Promise);
  runtime.reset();
  assert.equal(await pending, false);
  runtime.drawCityPointsLayer(2);
  assert.equal(metrics.at(-1).detail.reason, "preparing");
  assert.equal(runtime.getCachedEffectiveCityCollection(), published);
  assert.equal(renders.filter(reason => reason === "city-plan-prepared").length, 1);
  assert.equal(await runtime.prepareCityPointsPass(), true);
  assert.notEqual(runtime.getCachedEffectiveCityCollection(), published);
  runtime.drawCityPointsLayer(2);
  assert.equal(metrics.at(-1).detail.reason, "no-data");
});

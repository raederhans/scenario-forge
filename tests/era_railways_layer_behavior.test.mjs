import test from "node:test";
import assert from "node:assert/strict";
import { createScenarioOptionalLayerRuntime } from "../js/core/scenario/optional_layer_runtime.js";
import { createTransportOverviewRenderOwner } from "../js/core/renderer/transport_overview_render_owner.js";
import { bindRenderBoundary } from "../js/core/render_boundary.js";

const railway = (level) => ({
  type: "Feature", properties: { kind: "railway", ...(level === undefined ? {} : { level }) },
  geometry: { type: "LineString", coordinates: [[0, 0], [1, 1]] },
});
const collection = (features) => ({ type: "FeatureCollection", features });

function renderHarness() {
  const strokes = [];
  const context = {
    save() {}, restore() {}, setLineDash() {}, beginPath() {},
    stroke() { strokes.push(this.lineWidth); },
  };
  const state = { showTransport: true, showEraRailways: true, showRail: false,
    scenarioEraRailwaysData: collection([railway(3), railway(1), railway(5), railway(), railway(2), railway(4)]) };
  const owner = createTransportOverviewRenderOwner({ state, helpers: {
    getContext: () => context, getPathCanvas: () => () => {},
    getProjection: () => (coordinates) => coordinates,
    clamp: (value, min, max) => Math.min(max, Math.max(min, value)), nowMs: () => 0,
    collectContextMetric() {},
    getFeatureCollectionFeatureCount: (data) => data?.features?.length || 0,
  } });
  return { owner, strokes };
}

test("era railways draw level batches with screen widths and halos while modern rail is hidden", () => {
  const { owner, strokes } = renderHarness();
  owner.drawRailwaysLayer(2);
  assert.equal(strokes.length, 10);
  const scale = Math.sqrt(2) / 1.4;
  [0.7, 1, 1.35, 1.75, 2.2].forEach((width, index) => {
    const [halo, main] = strokes.slice(index * 2, index * 2 + 2);
    assert.equal(main, width * scale / 2);
    assert.equal(halo, (width * scale + 1.2) / 2);
  });
});

function loadingHarness(loader) {
  const bundle = { manifest: { era_railways_url: "era.geojson" } };
  const state = { activeScenarioId: "test", scenarioBundleCacheById: { test: bundle },
    showEraRailways: true, showWaterRegions: false, showScenarioSpecialRegions: false,
    showScenarioAtlantropa: false, showSpecialZones: false, showScenarioReliefOverlays: false,
    showCityPoints: false, showStrategicResourceMarkers: false };
  const runtime = createScenarioOptionalLayerRuntime(state, {
    getScenarioBundleId: () => "test", scenarioBundleUsesChunkedLayer: () => false,
    scheduleScenarioChunkRefresh() {}, recordOptionalLayerVisibilitySnapshot() {},
    shouldContinueScenarioApplyContext: context => state.activeScenarioId === context.scenarioId,
    loadScenarioOptionalLayerPayloadById: loader,
  });
  return { state, runtime };
}

test("background completion ignores stale scenarios and replaced bundles", async (t) => {
  const renders = [];
  bindRenderBoundary({ flushRender: (event) => renders.push(event.reason) });
  t.after(() => bindRenderBoundary({}));
  for (const change of [(h) => { h.state.activeScenarioId = "other"; },
    (h) => { h.state.scenarioBundleCacheById.test = {}; }]) {
    let resolve;
    const pending = new Promise((done) => { resolve = done; });
    const h = loadingHarness(() => pending);
    await h.runtime.ensureActiveScenarioOptionalLayersForVisibility();
    change(h);
    resolve(null);
    await pending;
  }
  assert.deepEqual(renders, []);
});

import test from "node:test";
import assert from "node:assert/strict";
import { createLabelsRuntime } from "../js/core/map_renderer/labels_runtime.js";
import { createBorderIdentityResolver } from "../js/core/renderer/border_identity.js";

test("capital marker loses its star during occupation and regains it on recovery", t => {
  class MarkerCanvas {
    getContext() {
      return {
        scale() {}, save() {}, restore() {}, beginPath() {}, closePath() {}, fill() {}, stroke() {}, moveTo() {},
        lineTo: () => { this.shape = "star"; }, arc: () => { this.shape = "circle"; },
      };
    }
  }
  const previous = Object.getOwnPropertyDescriptor(globalThis, "OffscreenCanvas");
  Object.defineProperty(globalThis, "OffscreenCanvas", { configurable: true, value: MarkerCanvas });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, "OffscreenCanvas", previous);
    else delete globalThis.OffscreenCanvas;
  });
  const state = {
    activeScenarioId: "scenario", currentLanguage: "en", width: 800, height: 600,
    zoomTransform: { x: 0, y: 0, k: 12 }, showCityPoints: true, styleConfig: { cityPoints: {} },
    scenarioCountriesByTag: { AA: {}, BB: { releasable: true } },
    sovereignBaseColors: { AA: "#aaaaaa", BB: "#bbbbbb" }, colorRevision: 0, visualOverrides: {},
    landIndex: new Map(["foreign", "seat", "province"].map(id => [id, { id }])),
    sovereigntyByFeatureId: { foreign: "BB", seat: "AA", province: "AA" },
    scenarioCityOverridesData: { capitals_by_tag: { AA: "old" } },
    worldCitiesData: { features: [{ type: "Feature", id: "old",
      properties: { name: "Old", __city_id: "old", __city_host_feature_id: "seat", __city_settlement_rank: "large" },
      geometry: { type: "Point", coordinates: [10, 10] } }] },
    projectCities: [{ id: "new", name: { en: "New", zh: "New" }, lon: 40, lat: 10, hostFeatureId: "province", tier: "major" }],
  };
  const resolve = createBorderIdentityResolver({
    sovereignBaseColors: () => state.sovereignBaseColors,
    getReferenceOwner: id => state.sovereigntyByFeatureId[id],
    getOverrideColor: id => state.visualOverrides[id],
  });
  const shapes = new Map();
  const ctx = { save() {}, restore() {}, drawImage(canvas, x, y, width) {
    shapes.set(Math.round(x + width / 2), canvas.shape);
  } };
  const projection = coords => coords;
  const runtime = createLabelsRuntime({
    runtimeState: state,
    rendererSurfaceHost: { getContext: () => ctx, getProjection: () => projection, getMapSvg: () => ({}) },
    resolveBorderIdentity: resolve,
    getResolvedFeatureColor: () => "#ffffff", getDisplayOwnerCode: () => "AA",
    clamp: (v, min, max) => Math.max(min, Math.min(max, v)), getSignedHashUnit: () => 0,
    getLabelPaintOverscanPx: () => 0, getFeatureCollectionFeatureCount: collection => collection.features.length,
    isExportRenderInProgress: () => false, isPrivateSceneActive: () => false,
    getHoverEntryHitPriority: () => 1, nowMs: () => 0, collectContextMetric() {}, recordInteractionDurationMetric() {},
  });
  function drawAndCheck(capitalX) {
    shapes.clear();
    runtime.drawCityPointsLayer(12);
    for (const x of [10, 40]) {
      assert.equal(shapes.get(x), x === capitalX ? "star" : "circle");
    }
  }
  drawAndCheck(10);
  state.visualOverrides = { seat: "#bbbbbb" };
  drawAndCheck(null);
  state.visualOverrides.seat = "#aaaaaa";
  state.colorRevision++;
  drawAndCheck(10);
});

import test from "node:test";
import assert from "node:assert/strict";
import { createLabelsRuntime } from "../js/core/map_renderer/labels_runtime.js";
import { createBorderIdentityResolver } from "../js/core/renderer/border_identity.js";

test("capital markers and hover text follow occupation, recovery, uniform recoloring and relocation", t => {
  class MarkerCanvas {
    getContext() {
      return {
        scale() {}, save() {}, restore() {}, beginPath() {}, closePath() {}, fill() {}, stroke() {}, moveTo() {},
        lineTo: () => { this.shape = "star"; }, arc: () => { this.shape = "circle"; },
      };
    }
  }
  for (const [name, value] of [["OffscreenCanvas", MarkerCanvas], ["d3", { pointer: event => event.point }]]) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, value });
    t.after(() => {
      if (previous) Object.defineProperty(globalThis, name, previous);
      else delete globalThis[name];
    });
  }
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
  const visited = [];
  const shapes = new Map();
  const ctx = { save() {}, restore() {}, drawImage(canvas, x, y, width) {
    shapes.set(Math.round(x + width / 2), canvas.shape);
  } };
  const projection = coords => coords;
  const runtime = createLabelsRuntime({
    runtimeState: state,
    rendererSurfaceHost: { getContext: () => ctx, getProjection: () => projection, getMapSvg: () => ({}) },
    resolveBorderIdentity(id, feature) { visited.push(id); return resolve(id, feature); },
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
      const hovered = runtime.getHoveredCityEntryFromEvent({ point: [12 * x, 120] });
      assert.equal(hovered.tooltipText.split("\n").includes("Capital"), x === capitalX);
    }
  }
  drawAndCheck(10);
  state.visualOverrides = { seat: "#bbbbbb" };
  drawAndCheck(null);
  state.visualOverrides.seat = "#aaaaaa";
  state.colorRevision++;
  drawAndCheck(10);
  state.visualOverrides = { seat: "#123456", province: "#123456" };
  drawAndCheck(10);
  state.capitalOverrides = { AA: { cityId: "new" } };
  visited.length = 0;
  drawAndCheck(40);
  assert.deepEqual(visited, ["province"]);
  visited.length = 0;
  drawAndCheck(40);
  assert.deepEqual(visited, []);
});

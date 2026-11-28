import test from "node:test";
import assert from "node:assert/strict";
import { createCityPointsRenderOwner } from "../js/core/renderer/city_points_render_owner.js";
import { normalizeCityLayerStyleConfig } from "../js/core/state_defaults.js";

function installCanvasFactory(t) {
  class MarkerCanvas {
    getContext() {
      return {
        scale() {}, save() {}, restore() {}, beginPath() {}, closePath() {},
        arc() {}, fill() {}, stroke() {}, lineTo() {}, moveTo() {},
      };
    }
  }
  const previous = Object.getOwnPropertyDescriptor(globalThis, "OffscreenCanvas");
  Object.defineProperty(globalThis, "OffscreenCanvas", { configurable: true, value: MarkerCanvas });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, "OffscreenCanvas", previous);
    else delete globalThis.OffscreenCanvas;
  });
}

function createCityPointsHarness({ markerEntries, labelEntries, styleConfig = {} }) {
  const calls = [];
  const context = {
    save() {}, restore() {},
    drawImage(...args) { calls.push({ type: "drawImage", args }); },
    set globalAlpha(value) { calls.push({ type: "globalAlpha", value }); },
  };
  const projection = () => [0, 0];
  const state = {
    colorRevision: 1,
    deferContextBasePass: false,
    showCityPoints: true,
    styleConfig: {
      cityPoints: {
        opacity: 0.9,
        showLabels: true,
        ...styleConfig,
      },
    },
    zoomTransform: { x: 0, y: 0, k: 2 },
  };
  const collection = {
    type: "FeatureCollection",
    features: markerEntries.map((entry) => entry.feature || { type: "Feature", properties: {} }),
  };
  const owner = createCityPointsRenderOwner({
    state,
    getters: {
      getContext: () => context,
      getMapSvg: () => ({ nodeName: "svg" }),
      getProjection: () => projection,
    },
    helpers: {
      buildCityRevealPlan: () => ({ markerEntries, labelEntries }),
      clamp: (value, min, max) => Math.min(max, Math.max(min, value)),
      getCityMarkerRenderStyle: () => ({ backgroundColor: "", tokens: {} }),
      getCityMarkerSizePx: (entry) => Number(entry?.markerSizePx || 12),
      getCityVisualCapitalState: (entry, config) => !!entry?.isCapital && config?.showCapitalOverlay !== false,
      getEffectiveCityCollection: () => collection,
      getFeatureCollectionFeatureCount: (candidate) => Array.isArray(candidate?.features) ? candidate.features.length : 0,
      normalizeCityLayerStyleConfig,
    },
  });
  return { owner, calls };
}

function createPrivateRevealHarness() {
  const entry = { id: "prepared-city", cityId: "prepared-city", anchor: [1, 2], screenPoint: [3, 4] };
  const h = { collection: { features: [{}] }, projection: () => [0, 0],
    state: { showCityPoints: true, width: 800, height: 500,
      zoomTransform: { x: 0, y: 0, k: 2 }, styleConfig: { cityPoints: { showLabels: true } } } };
  h.owner = createCityPointsRenderOwner({ state: h.state,
    getters: {
      getProjection: () => h.projection,
    },
    helpers: {
      getCachedEffectiveCityCollection: () => h.publishedCollection || h.collection,
      getEffectiveCityCollectionSource: () => ({ collection: h.collection, features: h.collection.features }),
      isEffectiveCityCollectionSourceCurrent: (source) => !!source
        && source.collection === h.collection && source.features === h.collection.features,
      prepareEffectiveCityCollection: async (source) => ({ source, collection: source.collection }),
      installEffectiveCityCollection: ({ collection }) => { h.publishedCollection = collection; return true; },
      normalizeCityLayerStyleConfig,
      isPrivatePreparationEnabled: () => true,
      prepareCityRevealPlan: async (_collection, _scale, _transform, _config, options) => {
        await options.yieldControl?.();
        return options.isCurrent() ? { markerEntries: [entry], labelEntries: [entry], labelBudget: 4 } : null;
      },
    },
  });
  return h;
}

test("late city preparation cannot replace the new scenario view", async () => {
  const h = createPrivateRevealHarness();
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  const previous = h.owner.prepareCurrentView(2, { yieldControl: () => held });
  h.state.activeScenarioId = "new-scene";
  const current = h.owner.prepareCurrentView(2, { yieldControl: async () => {} });
  assert.equal(await current, true);
  release();
  assert.equal(await previous, false);
  assert.equal(h.owner.getCityLayerRenderState(2).skipped, false);
});

test("overview country titles displace ordinary markers while capitals keep priority", (t) => {
  installCanvasFactory(t);
  const capital = { id: "capital", isCapital: true, markerSizePx: 10, anchor: [40, 50], screenPoint: [80, 100] };
  const city = { id: "ordinary", anchor: [150, 50], screenPoint: [300, 100],
    feature: { type: "Feature", properties: { __city_host_feature_id: "LAND1" } } };
  const harness = createCityPointsHarness({ markerEntries: [capital, city], labelEntries: [capital, city] });
  const boxes = [];
  const reservation = harness.owner.reserveOverviewLabelBoxes(2, boxes);
  assert.equal(boxes.length, 1, "only the capital marker reserves space ahead of country titles");
  boxes.push({ x: 290, y: 90, w: 40, h: 20 });
  harness.owner.drawLabelsPass(2, { occupiedBoxes: boxes, overviewLayout: reservation });
  assert.equal(harness.calls.filter(call => call.type === "drawImage").length, 1, "the covered ordinary marker is omitted");
});

test("zero opacity reaches the city marker draw", (t) => {
  installCanvasFactory(t);
  const entry = {
    id: "opacity-city",
    anchor: [40, 50],
    screenPoint: [80, 100],
    cityTier: "major",
    markerSizePx: 16,
  };
  const harness = createCityPointsHarness({ markerEntries: [entry], labelEntries: [entry], styleConfig: { opacity: 0 } });
  harness.owner.drawCityPointsLayer(2);
  const alphaCalls = harness.calls.filter(call => call.type === "globalAlpha");
  assert.deepEqual(alphaCalls.map(call => call.value), [0]);
  assert.equal(harness.calls.filter(call => call.type === "drawImage").length, 1);
});

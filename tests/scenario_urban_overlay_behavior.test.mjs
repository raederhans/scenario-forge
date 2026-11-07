import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createContextLayerResolverOwner } from "../js/core/renderer/context_layer_resolver.js";
import { getUrbanFeatureOwnerId } from "../js/core/renderer/urban_adaptive_paint_model.js";
import { commitContextLayerCollection } from "../js/core/state/content_state.js";
import {
  appendScenarioUrbanOverlay,
  getActiveScenarioUrbanOverlayLayerName,
} from "../js/core/renderer/scenario_urban_overlay.js";
import { createUrbanLayerRenderOwner } from "../js/core/renderer/urban_layer_render_owner.js";
import { normalizeUrbanStyleConfig } from "../js/core/state_defaults.js";

const require = createRequire(import.meta.url);
const d3 = require("../vendor/d3.v7.min.js");
const topojson = require("../vendor/topojson-client.min.js");

const OVERLAY_LAYER = "urban_tno_atlantropa";

function square(id, owner, x) {
  return {
    type: "Feature",
    properties: { id, country_owner_id: owner, country_owner_code: "XX", country_owner_method: "max_overlap" },
    geometry: { type: "Polygon", coordinates: [[[x, 0], [x, 1], [x + 1, 1], [x + 1, 0], [x, 0]]] },
  };
}

function fixture(t) {
  const saved = { d3: globalThis.d3, topojson: globalThis.topojson, info: console.info, warn: console.warn };
  globalThis.d3 = d3;
  globalThis.topojson = topojson;
  console.info = () => {};
  console.warn = () => {};
  t.after(() => {
    globalThis.d3 = saved.d3; globalThis.topojson = saved.topojson;
    console.info = saved.info; console.warn = saved.warn;
  });
  // A primary topology without urban, so the external urban pack is the selected source.
  const state = {
    topologyPrimary: {
      type: "Topology",
      arcs: [[[0, 0], [0, 8], [12, 8], [12, 0], [0, 0]]],
      objects: { land: { type: "GeometryCollection", geometries: [{ type: "Polygon", arcs: [[0]], id: "land" }] } },
    },
    topologyBundleMode: "composite",
    activeScenarioId: "tno_1962",
    contextLayerRevision: 0,
    showScenarioAtlantropa: true,
    scenarioAtlantropaData: { type: "FeatureCollection", features: [square("ATLPRV_1", "ATLPRV_1", 20)] },
  };
  const resolver = createContextLayerResolverOwner({
    runtimeState: state,
    helpers: {
      clamp: (value, min, max) => Math.max(min, Math.min(max, value)),
      getUrbanFeatureOwnerId,
      getUrbanFeatureStableId: (feature) => feature.properties?.id || "",
      getContextLayerStableSourceToken: () => "",
      resetScenarioWaterCacheAdaptiveState: () => {},
    },
    caches: { layerResolverCache: {} },
  });
  const base = { type: "FeatureCollection", features: [square("UA_BASE_1", "DE-1", 0), square("UA_BASE_2", "FR-1", 2)] };
  const overlay = { type: "FeatureCollection", features: [square("UA_ATL_0001", "ATLPRV_1", 20)] };
  commitContextLayerCollection(state, "urban", base, { bumpRevision: true });
  return { state, resolver, base, overlay };
}

const ids = (collection) => collection.features.map((feature) => feature.properties.id);

test("TNO appends the loaded Atlantropa urban supplement after the selected urban source", (t) => {
  const f = fixture(t);
  f.resolver.ensureLayerDataFromTopology();
  assert.deepEqual(ids(f.state.urbanData), ["UA_BASE_1", "UA_BASE_2"]);
  assert.equal(getActiveScenarioUrbanOverlayLayerName(f.state), OVERLAY_LAYER);

  commitContextLayerCollection(f.state, OVERLAY_LAYER, f.overlay, { bumpRevision: true });
  f.resolver.ensureLayerDataFromTopology();
  assert.deepEqual(ids(f.state.urbanData), ["UA_BASE_1", "UA_BASE_2", "UA_ATL_0001"]);
  assert.equal(f.state.contextLayerSourceByName.urban, "external");
  assert.equal(f.state.urbanLayerCapability.featureCount, 3);
  assert.equal(f.state.urbanLayerCapability.adaptiveAvailable, true);
  // Base collections stay untouched for other scenarios.
  assert.deepEqual(ids(f.base), ["UA_BASE_1", "UA_BASE_2"]);

  const merged = f.state.urbanData;
  f.state.contextLayerRevision += 1;
  f.resolver.ensureLayerDataFromTopology();
  assert.equal(f.state.urbanData, merged, "unchanged inputs reuse the merged collection");
});

test("hiding Atlantropa land or leaving TNO removes the supplement; returning restores it", (t) => {
  const f = fixture(t);
  commitContextLayerCollection(f.state, OVERLAY_LAYER, f.overlay, { bumpRevision: true });
  f.resolver.ensureLayerDataFromTopology();
  assert.equal(f.state.urbanData.features.length, 3);

  f.state.showScenarioAtlantropa = false;
  f.resolver.ensureLayerDataFromTopology();
  assert.equal(f.state.urbanData, f.base);
  assert.equal(getActiveScenarioUrbanOverlayLayerName(f.state), "");

  f.state.showScenarioAtlantropa = true;
  f.resolver.ensureLayerDataFromTopology();
  assert.equal(f.state.urbanData.features.length, 3);

  f.state.activeScenarioId = "hoi4_1936";
  f.resolver.ensureLayerDataFromTopology();
  assert.equal(f.state.urbanData, f.base);
  assert.equal(f.state.urbanLayerCapability.featureCount, 2);

  f.state.activeScenarioId = "tno_1962";
  f.state.scenarioAtlantropaData = null;
  f.resolver.ensureLayerDataFromTopology();
  assert.equal(f.state.urbanData, f.base, "no supplement while Atlantropa land is not loaded");
});

test("the supplement never stands in for a missing base urban layer", (t) => {
  const f = fixture(t);
  f.state.contextLayerExternalDataByName = { [OVERLAY_LAYER]: f.overlay };
  f.state.urbanData = null;
  f.resolver.ensureLayerDataFromTopology();
  assert.equal(f.state.urbanData?.features?.length || 0, 0);
});

test("base urban drawing leaves supplements to the scenario pass, which draws only them", () => {
  const base = { type: "FeatureCollection", features: [square("UA_BASE_1", "DE-1", 0), square("UA_BASE_2", "FR-1", 2)] };
  const overlay = { type: "FeatureCollection", features: [square("UA_ATL_0001", "ATLPRV_1", 20)] };
  const state = {
    showUrban: true, urbanData: appendScenarioUrbanOverlay(base, overlay), contextLayerRevision: 1,
    urbanLayerCapability: { adaptiveAvailable: false }, styleConfig: { urban: { mode: "manual" } },
  };
  const drawn = [];
  const context = { save() {}, restore() {}, setLineDash() {}, beginPath() {}, fill() {}, stroke() {} };
  const pathCanvas = (feature) => drawn.push(feature.properties.id);
  pathCanvas.context = () => context;
  const owner = createUrbanLayerRenderOwner({ state, helpers: {
    clamp: (value, min, max) => Math.max(min, Math.min(max, value)),
    getContext: () => context, getPathCanvas: () => pathCanvas, getProjection: () => ({}), getPath2D: () => null,
    createDrawPaintResolver: () => () => null, getEffectiveUrbanMode: () => "manual",
    getSafeBlendMode: (value, fallback) => value || fallback, getSafeCanvasColor: (value, fallback) => value || fallback,
    getUrbanGlowFeatureMultiplier: () => 1, getUrbanLayerCapability: () => state.urbanLayerCapability,
    normalizeUrbanStyleConfig, nowMs: () => 0, estimateProjectedAreaPx: () => 100, pathBoundsInScreen: () => true,
    collectContextMetric: () => {},
  } });

  owner.drawUrbanLayer(1);
  assert.deepEqual(drawn.splice(0), ["UA_BASE_1", "UA_BASE_2"]);
  owner.drawUrbanLayer(1, { scope: "scenario-overlay" });
  assert.deepEqual(drawn.splice(0), ["UA_ATL_0001"]);

  state.urbanData = base;
  owner.drawUrbanLayer(1, { scope: "scenario-overlay" });
  assert.deepEqual(drawn, [], "nothing to draw once the supplement is removed");
});

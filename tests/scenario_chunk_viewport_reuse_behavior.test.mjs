import test from "node:test";
import assert from "node:assert/strict";
import { createScenarioChunkRuntimeController } from "../js/core/scenario/chunk_runtime.js";
import { normalizeScenarioFeatureCollection, getScenarioFeatureCollectionIdentityList, areScenarioFeatureCollectionsEquivalent } from "../js/core/scenario/pure_helpers.js";
import { SCENARIO_OPTIONAL_LAYER_CONFIGS } from "../js/core/scenario/optional_layer_runtime.js";
import { resolveRequiredScenarioSemanticLayers } from "../js/core/scenario_chunk_manager.js";

function fixture(t, { globalCoverage = true, scenarioId = "viewport-test" } = {}) {
  const timers = new Map();
  let timerId = 0;
  t.mock.method(globalThis, "setTimeout", (callback) => { timers.set(++timerId, callback); return timerId; });
  t.mock.method(globalThis, "clearTimeout", (id) => timers.delete(id));
  const originalRaf = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = (callback) => { queueMicrotask(callback); return 1; };
  t.after(() => { if (originalRaf) globalThis.requestAnimationFrame = originalRaf; else delete globalThis.requestAnimationFrame; });
  const makeFeature = (id) => ({ type: "Feature", id, properties: { id, cntr_code: "AA" }, geometry: { type: "Polygon", coordinates: [[[0, 0], [0, 1], [1, 1], [0, 0]]] } });
  const first = { id: "political.coarse.world", url: "world.json", layer: "political", lod: "coarse", globalCoverage };
  const second = { id: "political.detail.next", url: "next.json", layer: "political", lod: "detail" };
  const payloads = new Map([[first.url, { type: "FeatureCollection", features: [makeFeature("a")] }], [second.url, { type: "FeatureCollection", features: [makeFeature("b")] }]]);
  const bundle = {
    manifest: { scenario_id: scenarioId },
    chunkRegistry: { byLayer: { political: [first, second] } },
    runtimeShell: { renderBudgetHints: { detail_zoom_threshold: 2 } },
    countriesPayload: { countries: {} }, chunkPayloadCacheById: {},
  };
  let subset = "west";
  let required = [first];
  const refreshes = [];
  const loads = [];
  let merges = 0;
  const state = { activeScenarioId: scenarioId, renderPhase: "idle", zoomTransform: { k: 3 }, renderPerfMetrics: {}, getViewportGeoBoundsFn: () => subset === "west" ? [-5, -5, 5, 5] : [0, -5, 10, 5] };
  const controller = createScenarioChunkRuntimeController({
    runtimeState: state, getSearchParams: () => new URLSearchParams(),
    normalizeScenarioId: (value) => String(value || ""), normalizeCountryCodeAlias: (value) => String(value || ""),
    normalizeScenarioPerformanceHints: (value) => value || {},
    normalizeScenarioFeatureCollection, getScenarioFeatureCollectionIdentityList, areScenarioFeatureCollectionsEquivalent,
    getScenarioDefaultCountryCode: () => "", getScenarioBundleId: () => scenarioId, getCachedScenarioBundle: () => bundle,
    getVisibleScenarioChunkLayers: () => ["political"],
    resolveRequiredScenarioSemanticLayers,
    selectScenarioChunks: () => ({ scenarioId, requiredChunks: required, optionalChunks: [], evictableChunkIds: [], politicalVisibleFeatureSubsetSignature: subset, selectedFeatureCountSum: required.length }),
    mergeScenarioChunkPayloads: (_layer, values) => { merges += 1; return { type: "FeatureCollection", features: values.flatMap((payload) => payload.features) }; },
    mergeScenarioChunkPayloadsForViewport: (_layer, values) => ({ payload: { type: "FeatureCollection", features: values.flatMap((payload) => payload.features) } }),
    normalizeScenarioRenderBudgetHints: (value) => value || {}, loadScenarioChunkFile: async (url) => { loads.push(url); return { payload: payloads.get(url) }; },
    scenarioSupportsChunkedRuntime: () => true, scenarioBundleUsesChunkedLayer: (_bundle, layer) => !layer || layer === "political",
    getScenarioOptionalLayerConfig: (layer) => SCENARIO_OPTIONAL_LAYER_CONFIGS[layer] || null, syncScenarioLocalizationState: () => {},
    refreshMapDataForScenarioChunkPromotion: (options) => refreshes.push(options), flushRenderBoundary: () => {},
    recordScenarioPerfMetric: () => {}, ensureScenarioChunkRegistryLoaded: async () => {},
  });
  return {
    state, controller, refreshes, payloads, first, second, bundle, loads,
    getMerges: () => merges,
    setSubset: (next) => { subset = next; }, setRequired: (next) => { required = next; },
    async refresh(reason = "viewport-test") {
      controller.scheduleScenarioChunkRefresh({ reason, delayMs: 0 });
      for (let i = 0; i < 80; i += 1) {
        const pending = [...timers.entries()]; timers.clear();
        for (const [, callback] of pending) callback();
        await Promise.resolve();
      }
      assert.equal(timers.size, 0, "controller must finish without a retry loop");
    },
  };
}

test("a committed global political collection survives pans without merge, promotion or version growth", async (t) => {
  const h = fixture(t); await h.refresh();
  const full = h.state.scenarioPoliticalChunkData;
  assert.equal(full?.globalCoverage, true);
  assert.ok(!h.state.scenarioPoliticalVisibleChunkData || h.state.scenarioPoliticalVisibleChunkData === full);
  const version = h.state.runtimeChunkLoadState.selectionVersion;
  const refreshCount = h.refreshes.length;
  const merges = h.getMerges();
  h.setSubset("east"); await h.refresh();
  h.setSubset("west"); await h.refresh();
  assert.equal(h.state.runtimeChunkLoadState.selectionVersion, version);
  assert.equal(h.state.scenarioPoliticalChunkData, full);
  assert.equal(h.refreshes.length, refreshCount);
  assert.equal(h.getMerges(), merges);
});

test("a newly required chunk still promotes geometry under committed global coverage", async (t) => {
  const h = fixture(t); await h.refresh();
  const version = h.state.runtimeChunkLoadState.selectionVersion;
  const refreshCount = h.refreshes.length;
  h.setSubset("east"); h.setRequired([h.first, h.second]); await h.refresh();
  assert.ok(h.state.runtimeChunkLoadState.selectionVersion > version);
  assert.ok(h.refreshes.length > refreshCount);
  assert.deepEqual(h.state.scenarioPoliticalChunkData.features.map((feature) => feature.id).sort(), ["a", "b"]);
});

test("legacy viewport-subset collections still promote on a changed viewport signature", async (t) => {
  const h = fixture(t, { globalCoverage: false }); await h.refresh();
  const version = h.state.runtimeChunkLoadState.selectionVersion;
  const refreshCount = h.refreshes.length;
  h.setSubset("east"); await h.refresh();
  assert.ok(h.state.runtimeChunkLoadState.selectionVersion > version);
  assert.ok(h.refreshes.length > refreshCount);
});

test("startup without a committed global collection cannot reuse the previous viewport selection", async (t) => {
  const h = fixture(t); await h.refresh();
  const version = h.state.runtimeChunkLoadState.selectionVersion;
  h.state.scenarioPoliticalChunkData = null;
  h.state.scenarioPoliticalVisibleChunkData = null;
  h.setSubset("east"); await h.refresh();
  assert.ok(h.state.runtimeChunkLoadState.selectionVersion > version);
});

test("replacing geometry under the same required chunk ID must publish the replacement", async (t) => {
  const h = fixture(t); await h.refresh();
  const original = h.state.scenarioPoliticalChunkData.features[0];
  const replacement = { ...original, geometry: { type: "Polygon", coordinates: [[[0, 0], [0, 2], [2, 2], [0, 0]]] } };
  const payload = { type: "FeatureCollection", features: [replacement] };
  h.payloads.set(h.first.url, payload);
  const payloadEntry = { layerKey: "political", payload };
  h.bundle.chunkPayloadCacheById[h.first.id] = payloadEntry;
  h.state.activeScenarioChunks.payloadByChunkId[h.first.id] = payloadEntry;
  const refreshCount = h.refreshes.length;
  h.setSubset("east"); await h.refresh();
  assert.ok(h.refreshes.length > refreshCount, "same-ID replacement must reach visual promotion");
  assert.deepEqual(h.state.scenarioPoliticalChunkData.features[0].geometry, replacement.geometry);
});

test("TNO zoom-end loads and commits required semantic water and relief while demoting ordinary optional detail", async (t) => {
  const h = fixture(t, { scenarioId: "tno_1962" });
  await h.refresh();
  const extra = ["water", "relief", "cities"].map((layer) => ({ id: `${layer}.detail.test`, url: `${layer}.json`, layer, lod: "detail" }));
  for (const chunk of extra) {
    h.bundle.chunkRegistry.byLayer[chunk.layer] = [chunk];
    h.payloads.set(chunk.url, { type: "FeatureCollection", features: [{ type: "Feature", id: `${chunk.layer}-feature`, properties: { id: `${chunk.layer}-feature` }, geometry: { type: "Point", coordinates: [1, 1] } }] });
  }
  h.setRequired([h.first, ...extra]);
  h.setSubset("east"); await h.refresh("zoom-end");
  const selection = h.state.runtimeChunkLoadState.lastSelection;
  assert.ok(selection.requiredChunkIds.includes("water.detail.test"), "water must remain required after zoom-end");
  assert.ok(selection.requiredChunkIds.includes("relief.detail.test"), "relief must remain required after zoom-end");
  assert.ok(selection.optionalChunkIds.includes("cities.detail.test"));
  assert.ok(!selection.requiredChunkIds.includes("cities.detail.test"));
  assert.ok(h.loads.includes("water.json")); assert.ok(h.loads.includes("relief.json"));
  assert.ok(!h.loads.includes("cities.json"));
  assert.equal(h.state.scenarioWaterRegionsData.features[0].id, "water-feature");
  assert.equal(h.state.scenarioReliefOverlaysData.features[0].id, "relief-feature");
  const full = h.state.scenarioPoliticalChunkData;
  const version = h.state.runtimeChunkLoadState.selectionVersion;
  const refreshCount = h.refreshes.length;
  h.setSubset("west"); await h.refresh("zoom-end");
  assert.equal(h.state.scenarioPoliticalChunkData, full);
  assert.equal(h.state.runtimeChunkLoadState.selectionVersion, version);
  assert.equal(h.refreshes.length, refreshCount, "pure pan over the same chunks must not promote political data again");
});

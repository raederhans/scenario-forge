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
    mergeScenarioChunkPayloads: (_layer, values) => { return { type: "FeatureCollection", features: values.flatMap((payload) => payload.features) }; },
    mergeScenarioChunkPayloadsForViewport: (_layer, values) => ({ payload: { type: "FeatureCollection", features: values.flatMap((payload) => payload.features) } }),
    normalizeScenarioRenderBudgetHints: (value) => value || {}, loadScenarioChunkFile: async (url) => { return { payload: payloads.get(url) }; },
    scenarioSupportsChunkedRuntime: () => true, scenarioBundleUsesChunkedLayer: (_bundle, layer) => !layer || layer === "political",
    getScenarioOptionalLayerConfig: (layer) => SCENARIO_OPTIONAL_LAYER_CONFIGS[layer] || null, syncScenarioLocalizationState: () => {},
    refreshMapDataForScenarioChunkPromotion: (options) => refreshes.push(options), flushRenderBoundary: () => {},
    recordScenarioPerfMetric: () => {}, ensureScenarioChunkRegistryLoaded: async () => {},
    requestRender: () => {},
  });
  return {
    state, controller, refreshes, payloads, first, second, bundle,
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

test("a newly required chunk still promotes geometry under committed global coverage", async (t) => {
  const h = fixture(t); await h.refresh();
  const version = h.state.runtimeChunkLoadState.selectionVersion;
  const refreshCount = h.refreshes.length;
  h.setSubset("east"); h.setRequired([h.first, h.second]); await h.refresh();
  assert.ok(h.state.runtimeChunkLoadState.selectionVersion > version);
  assert.ok(h.refreshes.length > refreshCount);
  assert.deepEqual(h.state.scenarioPoliticalChunkData.features.map((feature) => feature.id).sort(), ["a", "b"]);
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

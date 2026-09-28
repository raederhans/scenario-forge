import test from "node:test";
import assert from "node:assert/strict";
import { createScenarioChunkRuntimeController } from "../js/core/scenario/chunk_runtime.js";
import { callRuntimeHook } from "../js/core/state/index.js";

function fixture({ loadFile = null } = {}) {
  const chunk = (layer, suffix = "coarse", globalCoverage = true) => ({
    id: `${layer}.${suffix}`, layer, lod: suffix === "detail" ? "detail" : "coarse",
    globalCoverage, url: `${layer}.${suffix}.json`,
  });
  const chunks = [
    chunk("political"), chunk("water"), chunk("scenario_atlantropa"),
    chunk("water", "detail"), chunk("water", "local", false),
  ];
  const bundle = {
    manifest: { scenario_id: "tno" },
    chunkRegistry: { byLayer: Object.fromEntries(
      ["political", "water", "scenario_atlantropa"].map((layer) => [layer, chunks.filter((entry) => entry.layer === layer)])
    ) },
    chunkPayloadCacheById: {},
    chunkPayloadProtectedIds: ["existing-selection"],
  };
  const state = {
    activeScenarioId: "tno", sceneGeneration: 3,
    activeScenarioChunks: { scenarioId: "tno", payloadByChunkId: {}, loadedChunkIds: [] },
    scenarioBundleCacheById: { tno: bundle },
  };
  const reads = [];
  const controller = createScenarioChunkRuntimeController({
    runtimeState: state,
    normalizeScenarioId: (value) => String(value || ""),
    getScenarioBundleId: (value) => value?.manifest?.scenario_id || "",
    getCachedScenarioBundle: (scenarioId) => state.scenarioBundleCacheById[scenarioId],
    loadScenarioChunkFile: async (url) => {
      reads.push(url);
      return loadFile ? loadFile(url) : { payload: { type: "FeatureCollection", features: [{ id: url }] } };
    },
    ensureScenarioChunkRegistryLoaded: async () => {},
  });
  return { state, bundle, reads, controller };
}

test("navigation source hook fetches only requested global coarse layers without changing selection pins", async () => {
  const { state, bundle, reads, controller } = fixture();
  const result = await callRuntimeHook(state, "ensureScenarioNavigationSourcesFn", {
    layers: ["water", "scenario_atlantropa"],
  });
  assert.deepEqual(result.political, []);
  assert.deepEqual(result.water.map((payload) => payload.features[0].id), ["water.coarse.json"]);
  assert.deepEqual(result.scenario_atlantropa.map((payload) => payload.features[0].id), ["scenario_atlantropa.coarse.json"]);
  assert.deepEqual(reads.sort(), ["scenario_atlantropa.coarse.json", "water.coarse.json"]);
  assert.deepEqual(bundle.chunkPayloadProtectedIds, ["existing-selection"]);
  assert.equal(state.runtimeChunkLoadState.selectionVersion, 0);
  assert.equal(state.runtimeChunkLoadState.pendingPromotion, null);
  assert.deepEqual(state.activeScenarioChunks.loadedChunkIds, []);
  const again = await controller.ensureScenarioNavigationSources({ layers: ["water"] });
  assert.equal(again.water[0], result.water[0], "loader reuses cached payloads");
  assert.equal(reads.length, 2);
  assert.deepEqual(await controller.ensureScenarioNavigationSources({ layers: [] }), {
    political: [], water: [], scenario_atlantropa: [],
  });
});

test("navigation source hook rejects a scene or bundle change before publishing old payloads", async () => {
  for (const change of [
    (state) => { state.sceneGeneration++; },
    (state) => { state.activeScenarioId = "hoi4"; },
    (state) => { state.scenarioBundleCacheById.tno = { manifest: { scenario_id: "tno" } }; },
  ]) {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const { state, controller } = fixture({ loadFile: () => gate });
    const pending = controller.ensureScenarioNavigationSources({ layers: ["water"] });
    await Promise.resolve();
    change(state);
    release({ payload: { features: [{ id: "old-water" }] } });
    await assert.rejects(pending, /stale/);
  }
});

test("navigation source hook propagates chunk load failures", async () => {
  const { controller } = fixture({ loadFile: async () => { throw new Error("network failed"); } });
  await assert.rejects(controller.ensureScenarioNavigationSources({ layers: ["water"] }), /network failed/);
});

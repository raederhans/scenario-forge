import test from "node:test";
import assert from "node:assert/strict";
import { createScenarioChunkRuntimeController } from "../js/core/scenario/chunk_runtime.js";

function fixture(loadFile) {
  const water = { id: "water.coarse", layer: "water", lod: "coarse", globalCoverage: true, url: "water.json" };
  const bundle = { manifest: { scenario_id: "tno" }, chunkRegistry: { byLayer: { water: [water] } }, chunkPayloadCacheById: {} };
  const state = {
    activeScenarioId: "tno", sceneGeneration: 3,
    activeScenarioChunks: { scenarioId: "tno", payloadByChunkId: {}, loadedChunkIds: [] },
    scenarioBundleCacheById: { tno: bundle },
  };
  const controller = createScenarioChunkRuntimeController({
    runtimeState: state,
    normalizeScenarioId: (value) => String(value || ""),
    getScenarioBundleId: (value) => value?.manifest?.scenario_id || "",
    getCachedScenarioBundle: (scenarioId) => state.scenarioBundleCacheById[scenarioId],
    loadScenarioChunkFile: loadFile,
    ensureScenarioChunkRegistryLoaded: async () => {},
  });
  return { state, controller };
}

test("navigation source hook rejects a scene or bundle change before publishing old payloads", async () => {
  for (const change of [
    (state) => { state.sceneGeneration++; },
    (state) => { state.activeScenarioId = "hoi4"; },
    (state) => { state.scenarioBundleCacheById.tno = { manifest: { scenario_id: "tno" } }; },
  ]) {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const { state, controller } = fixture(() => gate);
    const pending = controller.ensureScenarioNavigationSources({ layers: ["water"] });
    await Promise.resolve();
    change(state);
    release({ payload: { features: [{ id: "old-water" }] } });
    await assert.rejects(pending, /stale/);
  }
});

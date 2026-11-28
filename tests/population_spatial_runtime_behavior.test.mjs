import test from "node:test";
import assert from "node:assert/strict";
import { ensurePopulationData, ensurePopulationHeatmapData, getPopulationHeatmapSnapshot } from "../js/core/thematic/population_spatial_runtime.js";
import { normalizePopulationStyle } from "../js/core/thematic/population_spatial_view_model.js";

import { POPULATION_LAYER_ID, POPULATION_DATA_VERSION } from "../js/core/thematic/population_spatial_data.js";
const geometry = "a".repeat(64);
function fixture() { return { activeScenarioId: "modern_world", activeScenarioManifest: { source: { runtime_topology_sha256: geometry } },
  styleConfig: { population: normalizePopulationStyle({ enabled: true }) }, scenarioBaselineOwnersByFeatureId: Object.freeze({ A: "AA" }) }; }
function payload(scenarioId = "modern_world") { return { layerId: POPULATION_LAYER_ID, dataVersion: POPULATION_DATA_VERSION,
  scenarioId, geometryVersion: geometry, year: 2020, byFeatureId: Object.freeze({ A: Object.freeze({ population: 0 }) }), counts: { features: 1 }, raster: {} }; }
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }

test("old scenario success or failure cannot overwrite a new scene", async () => {
  for (const failure of [false, true]) {
    const state = fixture(), old = deferred();
    const first = ensurePopulationData(state, { loadData: () => old.promise });
    await Promise.resolve(); state.activeScenarioId = "hoi4_1936";
    const data = payload(state.activeScenarioId);
    assert.equal(await ensurePopulationData(state, { loadData: async () => data }), data);
    if (failure) old.reject(new Error("stale")); else old.resolve(payload());
    assert.equal(await first, null); assert.equal(state.populationRuntime.data, data);
  }
});

test("explicit retry remembers failed detail IDs and retains ready overview", async () => {
  const state = fixture(); await ensurePopulationData(state, { loadData: async () => payload() });
  await ensurePopulationHeatmapData(state, { loadTiles: async () => ({ overview: {}, detail: [] }) });
  await ensurePopulationHeatmapData(state, { detailTileIds: ["one"], loadTiles: async () => { throw new Error("tile offline"); } });
  const failed = getPopulationHeatmapSnapshot(state);
  assert.equal(failed.status, "ready"); assert.equal(failed.refinementStatus, "failed");
  assert.deepEqual(failed.requestedDetailTileIds, ["one"]);
  let selected;
  await ensurePopulationHeatmapData(state, { retry: true, loadTiles: async (_raster, options) => {
    selected = options.detailTileIds; return { overview: {}, detail: [{}] };
  } });
  assert.deepEqual(selected, ["one"]); assert.equal(getPopulationHeatmapSnapshot(state).refinementStatus, "ready");
});

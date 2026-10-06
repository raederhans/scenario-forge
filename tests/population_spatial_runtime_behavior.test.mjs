import test from "node:test";
import assert from "node:assert/strict";
import { ensurePopulationData, ensurePopulationHeatmapData, getPopulationHeatmapSnapshot } from "../js/core/population_spatial_runtime.js";
import { normalizePopulationStyle } from "../js/core/population_spatial_view_model.js";
import { setPopulationStyleState } from "../js/core/state/actions/population_spatial_actions.js";
import { POPULATION_LAYER_ID, POPULATION_DATA_VERSION } from "../js/core/population_spatial_data.js";
const geometry = "a".repeat(64);
function fixture() { return { activeScenarioId: "modern_world", activeScenarioManifest: { source: { runtime_topology_sha256: geometry } },
  styleConfig: { population: normalizePopulationStyle({ enabled: true }) }, scenarioBaselineOwnersByFeatureId: Object.freeze({ A: "AA" }) }; }
function payload(scenarioId = "modern_world") { return { layerId: POPULATION_LAYER_ID, dataVersion: POPULATION_DATA_VERSION,
  scenarioId, geometryVersion: geometry, year: 2020, byFeatureId: Object.freeze({ A: Object.freeze({ population: 0 }) }), counts: { features: 1 }, raster: {} }; }
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }

test("runtime coalesces data loads and preserves ready data on mode/opacity changes", async () => {
  const state = fixture(), pending = deferred(); let calls = 0;
  const options = { loadData: () => { calls += 1; return pending.promise; } };
  const request = ensurePopulationData(state, options);
  assert.equal(ensurePopulationData(state, options), request);
  const data = payload(); pending.resolve(data); assert.equal(await request, data);
  // Appearance ownership admits population via the main-agent integration.
  setPopulationStyleState(state, { ...state.styleConfig.population, mode: "heatmap", opacity: 0.4 });
  assert.equal(state.populationRuntime.status, "ready");
  assert.equal(await ensurePopulationData(state, options), data);
  assert.equal(calls, 1);
});

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

test("geometry drift and missing complete baseline membership fail explicitly; failures require retry", async () => {
  const state = fixture(); let calls = 0;
  const loadData = async () => { calls += 1; return { ...payload(), geometryVersion: "b".repeat(64) }; };
  assert.equal(await ensurePopulationData(state, { loadData }), null);
  assert.equal(state.populationRuntime.status, "failed");
  await ensurePopulationData(state, { loadData }); assert.equal(calls, 1);
  assert.equal(await ensurePopulationData(state, { retry: true, loadData: async () => payload() }), state.populationRuntime.data);
  state.scenarioBaselineOwnersByFeatureId = { A: "AA", B: "AA" };
  setPopulationStyleState(state, { enabled: false }); setPopulationStyleState(state, { enabled: true });
  assert.equal(await ensurePopulationData(state, { loadData: async () => payload() }), null);
  assert.match(state.populationRuntime.error, /missing baseline feature B/);
});

test("enabling population turns off competing overlays and stale disabled completion is fenced", async () => {
  const state = fixture(), pending = deferred();
  state.styleConfig.thematic = { enabled: true }; state.strategicChoroplethMetric = "value";
  setPopulationStyleState(state, { enabled: true });
  assert.equal(state.styleConfig.thematic.enabled, false); assert.equal(state.strategicChoroplethMetric, "");
  const request = ensurePopulationData(state, { loadData: () => pending.promise });
  setPopulationStyleState(state, { enabled: false }); pending.resolve(payload());
  assert.equal(await request, null); assert.equal(state.populationRuntime.status, "idle");
});

test("heatmap tile readiness coalesces and stale tile completion cannot publish", async () => {
  const state = fixture(); await ensurePopulationData(state, { loadData: async () => payload() });
  const pending = deferred(); let calls = 0;
  const options = { loadTiles: () => { calls += 1; return pending.promise; } };
  const first = ensurePopulationHeatmapData(state, options);
  assert.equal(ensurePopulationHeatmapData(state, options), first);
  assert.equal(getPopulationHeatmapSnapshot(state).status, "loading");
  pending.resolve({ overview: {}, detail: [] }); await first;
  assert.equal(getPopulationHeatmapSnapshot(state).status, "ready"); assert.equal(calls, 1);
  const next = deferred(); await ensurePopulationData(state, { loadData: async () => payload() });
  setPopulationStyleState(state, { enabled: false }); setPopulationStyleState(state, { enabled: true });
  await ensurePopulationData(state, { loadData: async () => payload() });
  const request = ensurePopulationHeatmapData(state, { loadTiles: () => next.promise });
  state.activeScenarioId = "tno_1962"; next.resolve({ overview: {}, detail: [] });
  assert.equal(await request, null); assert.equal(getPopulationHeatmapSnapshot(state).status, "idle");
});

test("viewport refinement keeps overview ready and publishes only the latest selected tile set", async () => {
  const state = fixture(); await ensurePopulationData(state, { loadData: async () => payload() });
  await ensurePopulationHeatmapData(state, { loadTiles: async () => ({ overview: { id: "overview" }, detail: [] }) });
  const old = deferred(), current = deferred();
  const first = ensurePopulationHeatmapData(state, { detailTileIds: ["one"], loadTiles: () => old.promise });
  assert.equal(getPopulationHeatmapSnapshot(state).status, "ready");
  assert.equal(getPopulationHeatmapSnapshot(state).refinementStatus, "loading");
  let selected;
  const second = ensurePopulationHeatmapData(state, { detailTileIds: ["two"], loadTiles: (raster, options) => {
    selected = options.detailTileIds; return current.promise;
  } });
  current.resolve({ overview: { id: "overview" }, detail: [{ id: "two" }] }); await second;
  old.resolve({ overview: { id: "overview" }, detail: [{ id: "one" }] }); assert.equal(await first, null);
  assert.deepEqual(selected, ["two"]);
  assert.deepEqual(getPopulationHeatmapSnapshot(state).loadedDetailTileIds, ["two"]);
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

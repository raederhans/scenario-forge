import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { normalizeScenarioChunkManifest, selectScenarioChunks } from "../js/core/scenario_chunk_manager.js";

const source = readFileSync(new URL("../js/core/scenario/chunk_runtime.js", import.meta.url), "utf8");
const start = source.indexOf("  async function ensureScenarioPoliticalDetailForExport(");
const end = source.indexOf("  function scheduleScenarioChunkRefresh(", start);
assert.ok(start > 0 && end > start);
const functionSource = source.slice(start, end);
function harness({ refresh, commit, family = true } = {}) {
  const detail = { type: "Polygon", coordinates: [[[0, 0], [1, 0], [0, 0]]] };
  const state = { activeScenarioId: "same", zoomTransform: { k: 2, x: 0, y: 0 },
    runtimeChunkLoadState: { selectionVersion: 1 },
    scenarioPoliticalChunkData: { features: [{ id: "a", geometry: {} }] },
    activeScenarioChunks: { payloadByChunkId: { detail: { payload: { features: [{ id: "a", geometry: detail }] } } } } };
  const bundle = { chunkRegistry: { byLayer: { political: family ? [{ lodGroupId: "family" }] : [] } } };
  const events = [];
  let current = true;
  const context = vm.createContext({ runtimeState: state, normalizeScenarioId: value => value,
    getCachedScenarioBundle: () => bundle,
    scenarioSupportsChunkedRuntime: () => true,
    ensureScenarioChunkRegistryLoaded: async () => {},
    captureScenarioChunkLoadStateContinuation: () => ({ continuationScenarioApplyRequestId: 1 }),
    isScenarioChunkLoadStateContinuationCurrent: () => current,
    ensureRuntimeChunkLoadState: () => state.runtimeChunkLoadState,
    refreshActiveScenarioChunks: async options => {
      events.push("load"); assert.equal(options.requireDetail, true);
      if (refresh) await refresh(state, () => { current = false; });
      return { requiredChunks: [{ id: "detail", lodGroupId: "family", lod: "detail" }] };
    },
    commitPendingScenarioChunkPromotionWithErrorBoundary: async options => {
      events.push("commit"); assert.equal(options.rethrow, true);
      if (commit) await commit(state, () => { current = false; });
      else state.scenarioPoliticalChunkData.features = [{ id: "a", geometry: detail }];
    },
  });
  vm.runInContext(functionSource, context);
  return { state, bundle, events, run: context.ensureScenarioPoliticalDetailForExport };
}

test("exact export waits for load and committed same-ID geometry without mutating edits", async () => {
  const h = harness();
  h.state.colors = { a: "#123456" };
  h.state.history = [{ a: "#abcdef" }];
  await h.run();
  assert.deepEqual(h.events, ["load", "commit"]);
  assert.deepEqual(h.state.colors, { a: "#123456" });
  assert.deepEqual(h.state.history, [{ a: "#abcdef" }]);
});
test("legacy export does not trigger chunk loading", async () => {
  const h = harness({ family: false }); await h.run(); assert.deepEqual(h.events, []);
});
for (const [name, options, pattern] of [
  ["load failure", { refresh: () => { throw new Error("decode failed"); } }, /decode failed/],
  ["same-ID scenario reapply", { refresh: (_state, stale) => stale() }, /map changed/],
  ["camera change", { refresh: state => { state.zoomTransform.x = 4; } }, /map changed/],
  ["apply in flight", { refresh: state => { state.scenarioApplyInFlight = true; } }, /map changed/],
  ["commit failure", { commit: () => { throw new Error("render failed"); } }, /render failed/],
  ["new selection", { commit: state => { state.runtimeChunkLoadState.selectionVersion++; } }, /finished rendering/],
  ["deferred promotion", { commit: state => { state.runtimeChunkLoadState.pendingPromotion = {}; } }, /finished rendering/],
  ["cached detail without rendered replacement", { commit: () => {} }, /could not be committed/],
]) {
  test(`exact export rejects ${name}`, async () => { await assert.rejects(harness(options).run(), pattern); });
}

test("exact selection upgrades admitted families outside detail zoom and ignores regional hysteresis", () => {
  const chunks = [
    { id: "regional", lod: "regional", min_zoom: 1, max_zoom: 4 },
    { id: "detail", lod: "detail", min_zoom: 4, max_zoom: 99 },
  ].map(chunk => ({ ...chunk, layer: "political", lod_group_id: "a", url: chunk.id,
    bounds: [0, 0, 5, 5], feature_count: 1 }));
  const registry = normalizeScenarioChunkManifest({ chunks });
  const options = { chunkRegistry: registry, zoom: 2, loadedChunkIds: ["regional"],
    viewportBbox: [0, 0, 5, 5], visibleLayers: ["political"] };
  assert.deepEqual(selectScenarioChunks(options).requiredChunks.map(chunk => chunk.id), ["regional"]);
  const exact = selectScenarioChunks({ ...options, requireDetail: true });
  assert.deepEqual(exact.requiredChunks.map(chunk => chunk.id), ["detail"]);
  assert.deepEqual(exact.evictableChunkIds, ["regional"]);
  assert.deepEqual(selectScenarioChunks(options).requiredChunks.map(chunk => chunk.id), ["regional"]);
  const missing = normalizeScenarioChunkManifest({ chunks: chunks.slice(0, 1) });
  assert.throws(() => selectScenarioChunks({ ...options, chunkRegistry: missing, requireDetail: true }), /Missing detail geometry/);
});

test("missing registry cannot silently bypass exact export", async () => {
  const h = harness();
  delete h.bundle.chunkRegistry;
  await assert.rejects(h.run(), /registry is not ready/);
  assert.deepEqual(h.events, []);
});

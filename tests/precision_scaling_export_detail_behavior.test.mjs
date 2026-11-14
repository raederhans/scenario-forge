import test from "node:test";
import assert from "node:assert/strict";
import { normalizeScenarioChunkManifest, selectScenarioChunks } from "../js/core/scenario_chunk_manager.js";

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

import test from "node:test";
import assert from "node:assert/strict";
import { normalizeScenarioChunkManifest, selectScenarioChunks, mergeScenarioChunkPayloadsForViewport } from "../js/core/scenario_chunk_manager.js";
const entries = [
  { id: "base", lod: "coarse", global_coverage: true, min_zoom: 0, max_zoom: 1.35 },
  { id: "regional", lod: "regional", lod_group_id: "x", min_zoom: 1.35, max_zoom: 4.5 },
  { id: "detail", lod: "detail", lod_group_id: "x", min_zoom: 4, max_zoom: 99 },
  { id: "legacy", lod: "detail", min_zoom: 1.35, max_zoom: 99 },
].map((c) => ({ ...c, layer: "political", url: `${c.id}.json`, bounds: [0, 0, 5, 5], feature_count: 1 }));
const registry = normalizeScenarioChunkManifest({ chunks: entries });
const selected = (zoom, loadedChunkIds = []) => selectScenarioChunks({ chunkRegistry: registry, zoom, loadedChunkIds,
  visibleLayers: ["political"], viewportBbox: [0, 0, 5, 5] }).requiredChunks.map((c) => c.id).sort();

test("legacy coarse always covers the world, while whole-shard families choose one precision", () => {
  assert.deepEqual(selected(1), ["base"]);
  assert.deepEqual(selected(2), ["base", "legacy", "regional"]);
  assert.deepEqual(selected(5), ["base", "detail", "legacy"]);
});

test("overlapping zoom ranges retain resident LOD until it exits, avoiding zoom-boundary churn", () => {
  assert.deepEqual(selected(4.2, ["regional"]), ["base", "legacy", "regional"]);
  assert.deepEqual(selected(4.2, ["detail"]), ["base", "detail", "legacy"]);
  assert.deepEqual(selected(4.6, ["regional"]), ["base", "detail", "legacy"]);
  assert.deepEqual(selected(3.9, ["detail"]), ["base", "legacy", "regional"]);
});

test("detail wins over regional and base independently of arrival order", () => {
  const f = (id, value) => ({ type: "Feature", properties: { id, value }, geometry: { type: "Point", coordinates: [0, 0] } });
  const base = { type: "FeatureCollection", features: [f("a", 0), f("b", 0)] };
  const regional = { type: "FeatureCollection", features: [f("a", 1)] };
  const detail = { type: "FeatureCollection", features: [f("a", 2)] };
  const result = mergeScenarioChunkPayloadsForViewport("political", [
    { chunk: registry.chunks[0], payload: base }, { chunk: registry.chunks[1], payload: regional },
    { chunk: registry.chunks[2], payload: detail },
  ]).payload;
  assert.equal(result.features.find((f) => f.properties.id === "a").properties.value, 2);
  assert.equal(result.features.find((f) => f.properties.id === "b").properties.value, 0);
});

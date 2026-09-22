import test from "node:test";
import assert from "node:assert/strict";
import { normalizeScenarioChunkManifest, selectScenarioChunks, selectScenarioFocusPrewarmChunks, mergeScenarioChunkPayloadsForViewport } from "../js/core/scenario_chunk_manager.js";
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

test("declared families prewarm display precision with hysteresis and reversible exact demand", () => {
  const chunks = registry.chunks.map((chunk) => ({ ...chunk, countryCodes: ["AA"] }));
  const prewarm = (options = {}) => selectScenarioFocusPrewarmChunks({ chunks, focusCountry: "AA",
    viewportBbox: [0, 0, 5, 5], zoom: 4.2, loadedChunkIds: ["regional"], ...options }).map((c) => c.id).sort();
  assert.deepEqual(prewarm(), ["legacy", "regional"]);
  assert.deepEqual(prewarm({ requireDetail: true }), ["detail", "legacy"]);
  assert.deepEqual(prewarm(), ["legacy", "regional"]);
  assert.deepEqual(prewarm({ zoom: 2 }), ["legacy", "regional"]);
  assert.deepEqual(prewarm({ zoom: 1 }), ["legacy"]);
  assert.deepEqual(prewarm({ zoom: 5 }), ["detail", "legacy"]);
  assert.deepEqual(prewarm({ zoom: undefined }), ["detail", "legacy"]);
});

test("prewarm families preserve viewport and decoded-byte limits as precision expands", () => {
  const chunks = normalizeScenarioChunkManifest({ chunks: Array.from({ length: 80 }, (_, i) => [
    { id: `r${i}`, lod: "regional", min_zoom: 1.35, max_zoom: 4.5, decoded_byte_size: 6 * 1024 ** 2 },
    { id: `d${i}`, lod: "detail", min_zoom: 4, max_zoom: 99, decoded_byte_size: 20 * 1024 ** 2 },
  ].map((c) => ({ ...c, lod_group_id: `g${i}`, country_codes: ["AA"], layer: "political",
    url: `${c.id}.json`, bounds: [i, 0, i + 0.9, 5], feature_count: 1 }))).flat() }).chunks;
  const options = { chunks, focusCountry: "AA", zoom: 2, viewportBbox: [0, 0, 79.9, 5],
    renderBudgetHints: { max_required_political_byte_size: 10 * 1024 ** 2 } };
  const warm = selectScenarioFocusPrewarmChunks(options);
  assert.equal(warm.length, 1);
  assert.equal(warm[0].lod, "regional");
  assert.equal(selectScenarioFocusPrewarmChunks({ ...options, viewportBbox: [40.1, 1, 40.8, 4] })[0].id, "r40");
  assert.equal(selectScenarioFocusPrewarmChunks({ ...options, requireDetail: true })[0].lod, "detail");
});

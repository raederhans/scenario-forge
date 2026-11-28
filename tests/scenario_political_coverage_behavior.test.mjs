import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { getFeatureId } from "../js/core/feature_identity.js";
import {
  isScenarioPoliticalBaseChunk,
  mergeScenarioChunkPayloads,
  mergeScenarioChunkPayloadsForViewport,
  normalizeScenarioChunkManifest,
  normalizeScenarioContextLodManifest,
  selectScenarioChunks,
} from "../js/core/scenario_chunk_manager.js";
import {
  buildMergedScenarioChunkLayerPayloads,
  buildScenarioChunkLayerSelectionSignatures,
} from "../js/core/scenario/chunk_layer_payloads.js";

test("published scenarios retain global political coverage across LODs", () => {
  for (const scenarioId of ["tno_1962", "hoi4_1936", "hoi4_1939"]) {
    const read = (name) => JSON.parse(readFileSync(new URL(`../data/scenarios/${scenarioId}/${name}`, import.meta.url), "utf8"));
    const chunkRegistry = normalizeScenarioChunkManifest(read("detail_chunks.manifest.json"));
    const contextLodManifest = normalizeScenarioContextLodManifest(read("context_lod.manifest.json"));
    const baseChunks = chunkRegistry.chunks.filter(isScenarioPoliticalBaseChunk);
    assert.ok(baseChunks.length > 0);
    let loadedChunkIds = baseChunks.map((chunk) => chunk.id);
    for (const zoom of [1, 1.35, 3, 10]) {
      for (const viewportBbox of [[-12, 40, 35, 65], [90, -15, 150, 55], [-140, 15, -60, 70]]) {
        const selection = selectScenarioChunks({
          scenarioId, chunkRegistry, contextLodManifest, zoom, viewportBbox,
          visibleLayers: ["political"], loadedChunkIds, focusCountry: "GER",
          renderBudgetHints: { max_required_political_chunks: 1, min_required_political_chunks: 1,
            max_required_political_estimated_path_cost: 1, max_required_political_byte_size: 1 },
        });
        for (const base of baseChunks) {
          assert.ok(selection.requiredChunks.some((chunk) => chunk.id === base.id));
          assert.ok(!selection.evictableChunkIds.includes(base.id));
        }
        loadedChunkIds = selection.requiredChunks.map((chunk) => chunk.id);
      }
    }
  }
});

test("detail replaces coarse by ID in either load order and pan downgrades to complete base coverage", () => {
  const coarseA = { id: 1, properties: { id: "a" }, geometry: { precision: "coarse-a" } };
  const coarseB = { id: 2, properties: { id: "b" }, geometry: { precision: "coarse-b" } };
  const detailA = { id: 3, properties: { id: "a" }, geometry: { precision: "detail-a" } };
  const detailB = { id: 4, properties: { id: "b" }, geometry: { precision: "detail-b" } };
  const chunkRegistry = normalizeScenarioChunkManifest({ chunks: [
    { id: "base", url: "base.json", layer: "political", lod: "coarse", global_coverage: true,
      max_zoom: 2, feature_count: 2, feature_bounds: [[0, 0, 10, 10], [50, 0, 60, 10]] },
    { id: "a", url: "a.json", layer: "political", lod: "detail", min_zoom: 2,
      bounds: [0, 0, 10, 10], feature_count: 1, feature_bounds: [[0, 0, 10, 10]] },
    { id: "b", url: "b.json", layer: "political", lod: "detail", min_zoom: 2,
      bounds: [50, 0, 60, 10], feature_count: 1, feature_bounds: [[50, 0, 60, 10]] },
  ] });
  const bundle = { chunkRegistry };
  const payload = (features) => ({ layerKey: "political", payload: { type: "FeatureCollection", features } });
  const state = { loadedChunkIds: [], payloadByChunkId: {
    base: payload([coarseA, coarseB]), a: payload([detailA]), b: payload([detailB]),
  } };
  const merge = (activeChunkIds, viewportBbox) => buildMergedScenarioChunkLayerPayloads(bundle, state, {
    activeChunkIds, viewportBbox,
    nextSignatures: buildScenarioChunkLayerSelectionSignatures(bundle, state, activeChunkIds),
    mergeScenarioChunkPayloads, mergeScenarioChunkPayloadsForViewport,
  });
  const assertFeatures = (collection, expected) => {
    assert.equal(collection.features.length, expected.length);
    for (const feature of expected) assert.equal(collection.features.find((item) => getFeatureId(item) === getFeatureId(feature)), feature);
  };
  for (const loadedChunkIds of [["base", "a", "b"], ["b", "a", "base"]]) {
    state.loadedChunkIds = loadedChunkIds;
    const nearA = merge(["base", "a"], [0, 0, 10, 10]);
    assert.equal(nearA.mergedLayerPayloads.political.globalCoverage, true);
    assert.equal(nearA.primaryMergedLayerPayloads.political, nearA.mergedLayerPayloads.political);
    assertFeatures(nearA.mergedLayerPayloads.political, [detailA, coarseB]);
    assertFeatures(nearA.primaryMergedLayerPayloads.political, [detailA, coarseB]);
    const nearB = merge(["base", "b"], [50, 0, 60, 10]);
    assertFeatures(nearB.mergedLayerPayloads.political, [coarseA, detailB]);
    assertFeatures(nearB.primaryMergedLayerPayloads.political, [coarseA, detailB]);
    const zoomOut = merge(["base"], [-180, -90, 180, 90]);
    assertFeatures(zoomOut.primaryMergedLayerPayloads.political, [coarseA, coarseB]);
  }
});

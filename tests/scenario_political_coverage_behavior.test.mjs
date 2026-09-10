import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { getFeatureId } from "../js/core/feature_identity.js";
import { normalizeScenarioFeatureCollection, getScenarioFeatureCollectionIdentityList,
  areScenarioFeatureCollectionsEquivalent } from "../js/core/scenario/pure_helpers.js";
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

for (const scenarioId of ["tno_1962", "hoi4_1936", "hoi4_1939"]) {
  test(`${scenarioId} retains real global political coverage across LOD, pan and detail budget limits`, () => {
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
        const details = selection.requiredChunks.filter((chunk) => !isScenarioPoliticalBaseChunk(chunk));
        assert.ok(details.length <= 1, "only detail consumes the count budget");
        if (zoom >= 1.35) assert.equal(details.length, 1, "base must not consume the minimum detail allowance");
        loadedChunkIds = selection.requiredChunks.map((chunk) => chunk.id);
      }
    }
  });
}

test("real TNO detail replaces coarse by canonical identity despite different topology IDs", () => {
  const read = (name) => JSON.parse(readFileSync(new URL(`../data/scenarios/tno_1962/chunks/political.${name}.json`, import.meta.url), "utf8"));
  const coarse = read("coarse.r0c0");
  const detail = read("detail.country.ger");
  const merged = mergeScenarioChunkPayloads("political", [detail, coarse]);
  const expected = new Map([...detail.features, ...coarse.features].map((feature) => [getFeatureId(feature), feature]));
  const actual = new Map(merged.features.map((feature) => [getFeatureId(feature), feature]));
  assert.equal(merged.features.length, expected.size);
  assert.equal(actual.size, expected.size);
  for (const id of expected.keys()) assert.ok(actual.has(id), `lost political region ${id}`);
  for (const feature of detail.features) assert.equal(actual.get(getFeatureId(feature)), feature);
  const overlappingTopologyIds = mergeScenarioChunkPayloads("political", [{ features: [
    { id: 4, properties: { id: "REGION_A" } },
    { id: 4, properties: { id: "REGION_B" } },
  ] }]);
  assert.equal(overlappingTopologyIds.features.length, 2, "topology sequence IDs must not collapse distinct regions");
});

test("political promotion preserves complete-coverage semantics through normalization and equality", () => {
  const feature = { id: 12, properties: { id: "REGION_A" } };
  const complete = { type: "FeatureCollection", features: [feature], globalCoverage: true };
  const normalized = normalizeScenarioFeatureCollection(complete);
  assert.equal(normalized.globalCoverage, true);
  assert.equal(normalized.features, complete.features);
  assert.deepEqual(getScenarioFeatureCollectionIdentityList(normalized), ["REGION_A"]);
  assert.equal(areScenarioFeatureCollectionsEquivalent(complete, normalized), true);
  assert.equal(areScenarioFeatureCollectionsEquivalent({ features: complete.features }, normalized), false);
});

test("detail replaces coarse by ID in either load order and pan downgrades to complete base coverage", () => {
  const coarseA = { id: "a", geometry: { precision: "coarse-a" } };
  const coarseB = { id: "b", geometry: { precision: "coarse-b" } };
  const detailA = { id: "a", geometry: { precision: "detail-a" } };
  const detailB = { id: "b", geometry: { precision: "detail-b" } };
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
    for (const feature of expected) assert.equal(collection.features.find((item) => item.id === feature.id), feature);
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
  // Also exercise the exported viewport merger without the layer builder's ordering.
  const projected = mergeScenarioChunkPayloadsForViewport("political", ["base", "a"].map((id) => ({
    chunk: chunkRegistry.chunks.find((chunk) => chunk.id === id), payload: state.payloadByChunkId[id].payload,
  })), [0, 0, 10, 10]);
  assertFeatures(projected.payload, [detailA, coarseB]);
});

import assert from "node:assert/strict";
import test from "node:test";
import { buildMergedScenarioChunkLayerPayloads } from "../js/core/scenario/chunk_layer_payloads.js";
import { mergeScenarioChunkPayloads, mergeScenarioChunkPayloadsForViewport } from "../js/core/scenario_chunk_manager.js";
import { getContourCoordinatePrecision, registerContourSourcePrecision } from "../js/core/paint_contour_source.js";

test("contour precision publication preserves deeply frozen borrowed payloads and result aliases", () => {
  const freeze = value => {
    if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); }
    return value;
  };
  const feature = { type: "Feature", id: "coarse-A", properties: { id: "coarse-A" },
    geometry: { type: "Polygon", coordinates: [[[0,0],[1,0],[1,1],[0,1],[0,0]]] } };
  const payload = { type: "FeatureCollection", features: [feature] };
  const chunk = { id: "coarse", layerKey: "political", lod: "coarse", coordinatePrecision: 4, globalCoverage: true };
  const bundle = freeze({ chunkRegistry: { byLayer: { political: [chunk] } } });
  const chunkState = freeze({ loadedChunkIds: ["coarse"], payloadByChunkId: { coarse: { layerKey: "political", payload } } });
  const before = JSON.stringify({bundle, chunkState});
  const result = buildMergedScenarioChunkLayerPayloads(bundle, chunkState, {
    mergeScenarioChunkPayloads, mergeScenarioChunkPayloadsForViewport,
  });
  assert.equal(getContourCoordinatePrecision(feature.geometry), 4);
  assert.equal(result.mergedLayerPayloads.political.features[0], feature, "reused borrowed features retain their original frozen identity");
  assert.equal(result.primaryMergedLayerPayloads.political, result.mergedLayerPayloads.political);
  registerContourSourcePrecision(payload, { ...chunk, lod: "detail" });
  assert.equal(getContourCoordinatePrecision(feature.geometry), 7);
  assert.equal(JSON.stringify({bundle, chunkState}), before, "provenance must not be written into saved inputs");
  assert.deepEqual(Object.keys(feature.geometry).sort(), ["coordinates", "type"]);
  assert.throws(() => { result.mergedLayerPayloads.political.features[0].properties.bad = true; }, TypeError);
});

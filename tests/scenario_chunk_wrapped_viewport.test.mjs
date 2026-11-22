import test from "node:test";
import assert from "node:assert/strict";
import { normalizeScenarioChunkManifest, selectScenarioChunks } from "../js/core/scenario_chunk_manager.js";

function selectIds(viewportBbox) {
  const chunks = [
    { id: "east", bounds: [175, 58, 179, 69] },
    { id: "west", bounds: [-179, 58, -172, 69] },
    { id: "far", bounds: [20, 58, 30, 69] },
    { id: "south", bounds: [175, 10, 179, 20] },
  ].map(chunk => ({ ...chunk, layer: "political", lod: "detail", lod_group_id: chunk.id, url: chunk.id,
    min_zoom: 1, max_zoom: 99, feature_count: 1 }));
  const result = selectScenarioChunks({ chunkRegistry: normalizeScenarioChunkManifest({ chunks }), zoom: 4,
    viewportBbox, visibleLayers: ["political"], requireDetail: true });
  return result.requiredChunks.map(chunk => chunk.id).sort();
}

test("a viewport crossing 180° keeps chunks on both sides of the dateline", () => {
  const ids = selectIds([172.68, 58.99, -169.63, 67.73]);
  assert.ok(ids.includes("east"));
  assert.ok(ids.includes("west"));
  assert.ok(!ids.includes("south"));
});

test("an ordinary viewport still selects only intersecting chunks", () => {
  assert.deepEqual(selectIds([170, 58.99, 180, 67.73]), ["east"]);
  assert.deepEqual(selectIds([-180, 58.99, -170, 67.73]), ["west"]);
});

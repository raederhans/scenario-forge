// Cost probe for a staged overlay; no source data writes or timing claims.
// node tests/precision_scaling_prewarm_cost.mjs <overlay-directory>
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import { normalizeScenarioChunkManifest, selectScenarioFocusPrewarmChunks } from "../js/core/scenario_chunk_manager.js";

const overlay = resolve(process.argv[2] || ".runtime/reports/generated/performance-lod-20260922");
const read = (path) => JSON.parse(path.endsWith(".gz") ? gunzipSync(readFileSync(path)) : readFileSync(path));
const manifest = read(resolve(overlay, "data/scenarios/tno_1962/detail_chunks.manifest.json"));
const chunks = normalizeScenarioChunkManifest(manifest).chunks;
const families = [...new Set(chunks.map((chunk) => chunk.lodGroupId).filter(Boolean))];
assert.ok(families.length > 0, "Overlay must declare a family");
const cost = (chunk) => {
  const staged = resolve(overlay, chunk.url);
  const payload = read(existsSync(staged) ? staged : resolve(chunk.url));
  return { coordinates: chunk.coordCount, compactPayloadBytes: Buffer.byteLength(JSON.stringify(payload)),
    ids: payload.features.map((f) => String(f.properties?.id || f.id)).sort() };
};
const results = families.map((family) => {
  const members = chunks.filter((chunk) => chunk.lodGroupId === family);
  const detail = members.find((chunk) => chunk.lod === "detail");
  const options = { chunks: members, focusCountry: detail.countryCodes[0], viewportBbox: detail.bounds };
  const before = selectScenarioFocusPrewarmChunks(options);
  const after = selectScenarioFocusPrewarmChunks({ ...options, zoom: 2 });
  assert.equal(before.length, 1); assert.equal(after.length, 1);
  const oldCost = cost(before[0]), newCost = cost(after[0]);
  assert.deepEqual(newCost.ids, oldCost.ids);
  return { family, before: { id: before[0].id, coordinates: oldCost.coordinates, compactPayloadBytes: oldCost.compactPayloadBytes },
    after: { id: after[0].id, coordinates: newCost.coordinates, compactPayloadBytes: newCost.compactPayloadBytes },
    preservedFeatureCount: oldCost.ids.length };
});
console.log(JSON.stringify({ measurement: "isolated-family prewarm at zoom=2; equal compact JSON serialization; not heap or FPS", results }, null, 2));

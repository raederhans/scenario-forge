import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeScenarioChunkManifest, selectScenarioChunks } from '../js/core/scenario_chunk_manager.js';

function registry() {
  return normalizeScenarioChunkManifest({ chunks: [
    { id: 'base', url: 'base.json.gz', layer: 'political', lod: 'coarse', global_coverage: true, bounds: [-180, -90, 180, 90] },
    ...[0, 1, 2, 3].map((index) => ({ id: `a.part.${index}`, url: `a.${index}.json.gz`, layer: 'political', lod: 'detail', min_zoom: 1.35, max_zoom: 99, bounds: [index * 10, 0, index * 10 + 9, 9], country_codes: ['AA'], owner_code: 'AA', byte_size: 100, decoded_byte_size: 1000, cache_byte_size: 2000, estimated_path_cost: 100, feature_count: 1 })),
  ] });
}

test('spatial selection keeps global base and only overlapping full-feature shards', () => {
  const chunks = registry();
  const result = selectScenarioChunks({ chunkRegistry: chunks, zoom: 3, viewportBbox: [11, 1, 18, 8], visibleLayers: ['political'], focusCountry: 'AA' });
  assert.deepEqual(result.requiredChunks.map((chunk) => chunk.id), ['base', 'a.part.1']);
});

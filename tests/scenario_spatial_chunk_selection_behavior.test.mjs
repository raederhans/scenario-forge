import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeScenarioChunkManifest, selectScenarioChunks, selectScenarioFocusPrewarmChunks } from '../js/core/scenario_chunk_manager.js';
import { recordScenarioChunkPayloadSourceBytes, getScenarioChunkPayloadEvictionIds } from '../js/core/scenario/bundle_cache_policy.js';

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
  assert.equal(result.selectedByteCountSum, 100);
  assert.equal(result.selectedDecodedByteCountSum, 1000);
  assert.equal(chunks.chunks[1].ownerCode, 'AA');
});

test('gzip does not evade the pre-encoding processing budget', () => {
  const result = selectScenarioChunks({ chunkRegistry: registry(), zoom: 3, viewportBbox: [0, 0, 39, 9], visibleLayers: ['political'], renderBudgetHints: { max_required_political_chunks: 4, min_required_political_chunks: 1, max_required_political_byte_size: 2100 } });
  assert.equal(result.requiredChunks.filter((chunk) => chunk.lod === 'detail').length, 1);
});

test('focus prewarm picks nearby shards and remains bounded for a whole country', () => {
  const chunks = registry().chunks;
  assert.deepEqual(selectScenarioFocusPrewarmChunks({ chunks, focusCountry: 'AA', viewportBbox: [21, 1, 28, 8] }).map((chunk) => chunk.id), ['a.part.2']);
  assert.equal(selectScenarioFocusPrewarmChunks({ chunks, focusCountry: 'AA', viewportBbox: [-180, -90, 180, 90] }).length, 2);
  assert.equal(selectScenarioFocusPrewarmChunks({ chunks, focusCountry: 'BB', viewportBbox: [0, 0, 39, 9] }).length, 0);
});

test('cache eviction uses decoded retention weight and still protects active entries', () => {
  const first = {}, second = {}, third = {};
  [first, second, third].forEach((entry) => recordScenarioChunkPayloadSourceBytes(entry, { byte_size: 20, decoded_byte_size: 25 * 1024 ** 2, cache_byte_size: 33 * 1024 ** 2 }));
  const bundle = { chunkPayloadCacheById: { first, second, third } };
  assert.deepEqual(getScenarioChunkPayloadEvictionIds(bundle, ['first']), ['second', 'third']);
  assert.deepEqual(getScenarioChunkPayloadEvictionIds(bundle, ['first', 'second', 'third']), []);
});

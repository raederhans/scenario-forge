import test from 'node:test';
import assert from 'node:assert/strict';
import { PoliticalIdRasterAssetValidationError, encodePoliticalIdRasterAsset, decodePoliticalIdRasterAsset, createPoliticalIdRasterAssetStore } from '../js/core/renderer/political_id_raster_assets.js';

const EDGE = 0x80000000;
const codeToId = new Map([[1, 'alpha'], [7, 'beta'], [12, 'gamma']]);
const idToCode = new Map([['alpha', 10], ['beta', 33], ['gamma', 2]]);
function tile() {
  return { width: 4, height: 1, originX: -1024, originY: 512,
    codes: new Uint32Array([1, EDGE, EDGE + 3, 0]),
    edgeIds: new Uint32Array([2, 1, 7, 1, 12]),
    edgeWeights: new Float32Array([0, 0.25, 0.5, 0, 0.75]) };
}
const encode = (identity = 'geometry:v1:tile:0') => encodePoliticalIdRasterAsset(tile(), { identity, codeToId });
function decode(buffer, identity = 'geometry:v1:tile:0') { return decodePoliticalIdRasterAsset(buffer, { identity, idToCode }); }
function memoryBackend() {
  const records = new Map();
  return {
    async read(identity) { return records.get(identity) ?? null; },
    async writeBounded(entry) { records.set(entry.identity, entry.payload.slice(0)); return true; },
    close() {},
  };
}
const createStore = (options = {}) => createPoliticalIdRasterAssetStore({ indexedDB: null, fetchImpl: null, ...options });

test('rejects bad headers, unsupported schema and incorrect payload length', () => {
  const original = encode();
  const mutations = [
    (v) => v.setUint8(0, 0),
    (v) => v.setUint32(8, 2, true),
  ];
  for (const mutate of mutations) {
    const buffer = original.slice(0); mutate(new DataView(buffer), buffer);
    assert.throws(() => decode(buffer), PoliticalIdRasterAssetValidationError);
  }
  assert.throws(() => decode(original.slice(0, -1)), PoliticalIdRasterAssetValidationError);
  const extra = new Uint8Array(original.byteLength + 4); extra.set(new Uint8Array(original));
  assert.throws(() => decode(extra.buffer), PoliticalIdRasterAssetValidationError);
});

test('persistent assets remap feature codes after reopening the store', async () => {
  const backend = memoryBackend();
  const first = createStore({ backend });
  assert.equal(await first.save('a', tile(), { codeToId }), true);
  first.dispose();
  const second = createStore({ backend });
  assert.equal((await second.load('a', { idToCode })).codes[0], 10);
  second.dispose();
});

test('malformed persistent assets are cache misses', async () => {
  const payload = encode('bad'); new DataView(payload).setUint32(8, 99, true);
  const store = createStore({ backend: { read: async () => payload } });
  assert.equal(await store.load('bad', { idToCode }), null);
  store.dispose();
});

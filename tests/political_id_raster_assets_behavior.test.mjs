import test from 'node:test';
import assert from 'node:assert/strict';
import {
  POLITICAL_ID_RASTER_ASSET_SCHEMA_VERSION,
  PoliticalIdRasterAssetValidationError,
  encodePoliticalIdRasterAsset,
  decodePoliticalIdRasterAsset,
  createPoliticalIdRasterAssetStore,
} from '../js/core/renderer/political_id_raster_assets.js';

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
function bodyOffset(buffer) { return 48 + Math.ceil(new DataView(buffer).getUint32(12, true) / 4) * 4; }
function decode(buffer, identity = 'geometry:v1:tile:0') { return decodePoliticalIdRasterAsset(buffer, { identity, idToCode }); }
function memoryBackend() {
  const records = new Map();
  let clock = 0;
  function prune(maxBytes) {
    let bytes = [...records.values()].reduce((sum, record) => sum + record.byteLength, 0);
    const ordered = [...records.values()].sort((a, b) => a.touched - b.touched);
    for (const record of ordered) {
      if (bytes <= maxBytes) break;
      records.delete(record.identity); bytes -= record.byteLength;
    }
  }
  return { records,
    async read(identity, maxBytes) {
      const record = records.get(identity);
      if (record) record.touched = ++clock;
      prune(maxBytes);
      return records.get(identity)?.payload ?? null;
    },
    async writeBounded(entry, maxBytes) {
      records.set(entry.identity, { ...entry, payload: entry.payload.slice(0), touched: ++clock });
      prune(maxBytes);
      return records.has(entry.identity);
    },
    close() {},
  };
}
const createStore = (options = {}) => createPoliticalIdRasterAssetStore({ indexedDB: null, fetchImpl: null, ...options });
const response = (buffer) => ({ ok: true, headers: { get: () => null }, arrayBuffer: async () => buffer });

test('binary coverage roundtrip remaps stable IDs without changing span offsets, counts, weights or background', () => {
  const buffer = encode();
  const result = decode(buffer);
  assert.deepEqual([...result.codes], [10, EDGE, EDGE + 3, 0]);
  assert.deepEqual([...result.edgeIds], [2, 10, 33, 1, 2]);
  assert.deepEqual(result.edgeWeights, tile().edgeWeights);
  assert.equal(result.originX, -1024); assert.equal(result.originY, 512);
  assert.equal(result.stats.edgePixelCount, 2);
  assert.equal(result.stats.contributionCount, 3);
  assert.deepEqual(decodePoliticalIdRasterAsset(buffer, { identity: 'geometry:v1:tile:0', idToCode: { alpha: 1, beta: 7, gamma: 12 } }).codes, tile().codes);
  assert.equal(decode(buffer, 'geometry:v2:tile:0'), null);
  assert.deepEqual(encode(), buffer, 'binary encoding is deterministic');
});

test('empty coverage is legal and does not need a feature mapping', () => {
  const empty = { width: 1, height: 1, originX: 0, originY: 0,
    codes: new Uint32Array(1), edgeIds: new Uint32Array(), edgeWeights: new Float32Array() };
  const payload = encodePoliticalIdRasterAsset(empty, { identity: 'empty' });
  assert.deepEqual(decodePoliticalIdRasterAsset(payload, { identity: 'empty' }).codes, empty.codes);
});

test('rejects unsupported schema, truncated/extra bytes, dimensions, offsets, counts and weights', () => {
  const original = encode();
  const mutations = [
    (v) => v.setUint8(0, 0),
    (v) => v.setUint32(8, 2, true),
    (v) => v.setUint32(12, 0xffffffff, true),
    (v) => v.setUint32(16, 0xffffffff, true),
    (v) => v.setUint32(24, 0, true),
    (v) => v.setFloat64(32, 0.5, true),
    (v, b) => v.setUint32(bodyOffset(b) + 4, EDGE + 1, true),
    (v, b) => v.setUint32(bodyOffset(b) + 16, 0, true),
    (v, b) => v.setUint32(bodyOffset(b) + 16, 99, true),
    (v, b) => v.setUint32(bodyOffset(b) + 20, 99, true),
    (v, b) => v.setFloat32(bodyOffset(b) + 36, 1, true),
    (v, b) => v.setFloat32(bodyOffset(b) + 40, NaN, true),
    (v, b) => v.setFloat32(bodyOffset(b) + 40, -1, true),
    (v, b) => v.setFloat32(bodyOffset(b) + 40, 0.75, true),
  ];
  for (const mutate of mutations) {
    const buffer = original.slice(0); mutate(new DataView(buffer), buffer);
    assert.throws(() => decode(buffer), PoliticalIdRasterAssetValidationError);
  }
  assert.throws(() => decode(original.slice(0, -1)), PoliticalIdRasterAssetValidationError);
  const extra = new Uint8Array(original.byteLength + 4); extra.set(new Uint8Array(original));
  assert.throws(() => decode(extra.buffer), PoliticalIdRasterAssetValidationError);
  assert.throws(() => decodePoliticalIdRasterAsset(original, { identity: 'geometry:v1:tile:0', idToCode, maxBytes: original.byteLength - 1 }), /byte budget/);
});

test('rejects unknown/duplicate feature IDs, invalid dictionaries and invalid caller tiles', () => {
  assert.throws(() => decodePoliticalIdRasterAsset(encode(), { identity: 'geometry:v1:tile:0', idToCode: { alpha: 1 } }), /feature code/);
  assert.throws(() => decodePoliticalIdRasterAsset(encode(), { identity: 'geometry:v1:tile:0', idToCode: () => 1 }), /duplicate palette/);
  assert.throws(() => encodePoliticalIdRasterAsset(tile(), { identity: 'test', codeToId: () => 'same' }), /duplicate stable/);
  assert.throws(() => encodePoliticalIdRasterAsset(tile(), { identity: 'test', codeToId: {} }), /stable feature ID/);
  const bad = tile(); bad.edgeIds[2] = 1;
  assert.throws(() => encodePoliticalIdRasterAsset(bad, { identity: 'test', codeToId }), /contributor/);
  const wrongLength = tile(); wrongLength.codes = new Uint32Array(1);
  assert.throws(() => encodePoliticalIdRasterAsset(wrongLength, { identity: 'test', codeToId }), /lengths/);
  const invalidUtf8 = encode(); new Uint8Array(invalidUtf8)[48] = 255;
  assert.throws(() => decode(invalidUtf8), /UTF-8/);
  const duplicateId = encode();
  const metadataLength = new DataView(duplicateId).getUint32(12, true);
  const bytes = new Uint8Array(duplicateId, 48, metadataLength);
  const text = new TextDecoder().decode(bytes).replace('gamma', 'alpha');
  bytes.set(new TextEncoder().encode(text));
  assert.throws(() => decode(duplicateId), /duplicate stable/);
});

test('persistent backend survives store recreation, remaps codes and applies byte-bounded LRU', async () => {
  const backend = memoryBackend();
  const size = encode('a').byteLength;
  const first = createStore({ backend, maxBytes: size * 2 });
  assert.equal(await first.save('a', tile(), { codeToId }), true);
  assert.equal(await first.save('b', tile(), { codeToId }), true);
  assert.equal(first.stats().memoryBytes, 0);
  first.dispose();
  const second = createStore({ backend, maxBytes: size * 2 });
  assert.equal((await second.load('a', { idToCode })).codes[0], 10);
  await second.save('c', tile(), { codeToId });
  assert.deepEqual([...backend.records.keys()].sort(), ['a', 'c']);
  assert.equal(await second.load('b', { idToCode }), null);
  assert.equal(second.stats().indexedDBHits, 1);
  assert.equal(second.stats().misses, 1);
  assert.equal(second.stats().pendingReads, 0);
  second.dispose();
});

test('quota and unavailable persistence fall back to bounded optional memory cache', async () => {
  const size = encode('a').byteLength;
  const failure = new Error('quota'); failure.name = 'QuotaExceededError';
  const backend = { read: async () => { throw failure; }, writeBounded: async () => { throw failure; } };
  const store = createStore({ backend, maxBytes: size * 4, memoryMaxBytes: size * 2 });
  await store.save('a', tile(), { codeToId }); await store.save('b', tile(), { codeToId });
  assert.equal((await store.load('a', { idToCode })).codes[0], 10);
  await store.save('c', tile(), { codeToId });
  assert.equal(await store.load('b', { idToCode }), null);
  assert.equal(store.stats().memoryHits, 1);
  assert.equal(store.stats().evictions, 1);
  assert.ok(store.stats().memoryBytes <= size * 2);
  assert.equal(store.stats().lastError.name, 'QuotaExceededError');
  assert.equal(store.stats().pendingWrites, 0);
  store.dispose(); assert.equal(store.stats().memoryBytes, 0);
  const unavailable = createStore();
  assert.equal(await unavailable.save('a', tile(), { codeToId }), false);
  assert.equal(await unavailable.load('a', { idToCode }), null);
});

test('no manifest performs no fetch; registered assets fetch once then use persistent cache', async () => {
  const backend = memoryBackend();
  let requests = 0;
  const buffer = encode('manifest');
  const store = createStore({ backend, baseUrl: 'https://example.test/app/', fetchImpl: async (url, options) => {
    requests += 1;
    assert.equal(url, 'https://example.test/app/tile.bin');
    assert.equal(options.mode, 'same-origin'); assert.ok(options.signal);
    return response(buffer);
  } });
  assert.equal(await store.load('manifest', { idToCode }), null); assert.equal(requests, 0);
  assert.equal(store.registerManifest({ schemaVersion: POLITICAL_ID_RASTER_ASSET_SCHEMA_VERSION,
    tiles: [{ identity: 'manifest', url: 'tile.bin', byteLength: buffer.byteLength }] }), 1);
  assert.equal((await store.load('manifest', { idToCode })).codes[0], 10);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(store.stats().pendingWrites, 0);
  assert.equal((await store.load('manifest', { idToCode })).codes[0], 10);
  assert.equal(requests, 1); assert.equal(store.stats().manifestHits, 1); assert.equal(store.stats().indexedDBHits, 1);
});

test('manifest validates schema, origin, URL credentials, duplicate identities and byte bounds atomically', () => {
  const store = createStore({ maxBytes: 2048, baseUrl: 'https://example.test/app/' });
  const entry = { identity: 'm', url: 'tile.bin', byteLength: 200 };
  store.registerManifest({ schemaVersion: 1, tiles: [entry] });
  for (const manifest of [
    { schemaVersion: 2, tiles: [entry] },
    { schemaVersion: 1, tiles: [entry, entry] },
    ...['https://other.test/tile', '//other.test/tile', 'javascript:alert(1)', 'https://u:p@example.test/tile', '\\evil\\tile'].map((url) => ({ schemaVersion: 1, tiles: [{ ...entry, url }] })),
    { schemaVersion: 1, tiles: [{ ...entry, byteLength: 2049 }] },
  ]) assert.throws(() => store.registerManifest(manifest), PoliticalIdRasterAssetValidationError);
  assert.equal(store.stats().manifestEntries, 1);
});

test('malformed persistent assets and fetch failures are cache misses with diagnostic counters', async () => {
  const payload = encode('bad'); new DataView(payload).setUint32(8, 99, true);
  const store = createStore({ backend: { read: async () => payload }, fetchImpl: async () => { throw new Error('offline'); } });
  store.registerManifest({ schemaVersion: 1, tiles: [{ identity: 'bad', url: './bad.bin', byteLength: payload.byteLength }] });
  assert.equal(await store.load('bad', { idToCode }), null);
  assert.equal(store.stats().failures, 2); assert.equal(store.stats().lastError.message, 'offline');
  assert.equal(store.stats().pendingReads, 0);
});

test('fetch enforces declared buffer and stream length; redirects cannot change origin', async () => {
  const buffer = encode('m');
  for (const result of [
    response(buffer.slice(0, -1)),
    { ...response(buffer), headers: { get: () => String(buffer.byteLength + 1) } },
    { ...response(buffer), url: 'https://other.test/tile' },
    { ok: true, headers: { get: () => null }, body: new ReadableStream({ start(controller) {
      controller.enqueue(new Uint8Array(buffer.byteLength + 1)); controller.close();
    } }) },
  ]) {
    const store = createStore({ baseUrl: 'https://example.test/', fetchImpl: async () => result });
    store.registerManifest({ schemaVersion: 1, tiles: [{ identity: 'm', url: './tile', byteLength: buffer.byteLength }] });
    assert.equal(await store.load('m', { idToCode }), null);
    assert.equal(store.stats().failures, 1);
  }
  const store = createStore({ fetchImpl: async () => ({ ok: true, headers: { get: () => null },
    body: new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(buffer)); controller.close(); } }) }) });
  store.registerManifest({ schemaVersion: 1, tiles: [{ identity: 'm', url: './tile', byteLength: buffer.byteLength }] });
  assert.equal((await store.load('m', { idToCode })).codes[0], 10);
});

test('abort propagates for fetch and queued backend work, exposes pending counts, and dispose cancels inflight loads', async () => {
  const buffer = encode('m');
  let fetchSignal;
  const store = createStore({ fetchImpl: (_url, { signal }) => { fetchSignal = signal; return new Promise(() => {}); } });
  store.registerManifest({ schemaVersion: 1, tiles: [{ identity: 'm', url: './tile', byteLength: buffer.byteLength }] });
  const controller = new AbortController();
  const loading = store.load('m', { idToCode, signal: controller.signal });
  assert.equal(store.stats().pendingReads, 1);
  controller.abort(); await assert.rejects(loading, { name: 'AbortError' });
  assert.equal(fetchSignal.aborted, true); assert.equal(store.stats().pendingReads, 0);
  const waiting = store.load('m', { idToCode }); store.dispose();
  await assert.rejects(waiting, { name: 'AbortError' });
  assert.equal(store.stats().failures, 0);
  await assert.rejects(store.load('m', { idToCode }), { name: 'AbortError' });

  let release, writes = 0;
  const backendStore = createStore({ memoryMaxBytes: 2048, backend: { writeBounded: () => {
    writes += 1; return new Promise((resolve) => { release = resolve; });
  } } });
  const first = backendStore.save('a', tile(), { codeToId });
  await Promise.resolve();
  const cancelled = new AbortController();
  const second = backendStore.save('b', tile(), { codeToId, signal: cancelled.signal });
  assert.equal(backendStore.stats().pendingWrites, 2);
  assert.equal(backendStore.stats().pendingBytes, encode('a').byteLength + encode('b').byteLength);
  cancelled.abort(); await assert.rejects(second, { name: 'AbortError' });
  release(true); await first;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(writes, 1); assert.equal(backendStore.stats().pendingWrites, 0);
  assert.equal(backendStore.stats().pendingBytes, 0);
  assert.equal(backendStore.stats().memoryEntries, 1);
});


test('compressed publication validates bytes and supports both static gzip and HTTP decoding', async () => {
  const { gzipSync } = await import('node:zlib');
  const { createHash } = await import('node:crypto');
  const payload = encode(), compressed = gzipSync(new Uint8Array(payload));
  const entry = { identity: 'geometry:v1:tile:0', url: './one.pidr.gz', byteLength: payload.byteLength,
    compression: 'gzip', compressedByteLength: compressed.length, sha256: createHash('sha256').update(new Uint8Array(payload)).digest('hex') };
  for (const httpDecoded of [false, true]) {
    const store = createStore({ fetchImpl: async () => new Response(httpDecoded ? payload : compressed,
      { headers: { 'content-length': String(compressed.length), ...(httpDecoded ? { 'content-encoding': 'gzip' } : {}) } }) });
    store.registerManifest({ schemaVersion: 1, tiles: [entry] });
    assert.deepEqual((await store.load(entry.identity, { idToCode })).codes, decode(payload).codes);
    assert.equal(store.stats().manifestHits, 1); store.dispose();
  }
  for (const wrong of [{ sha256: '0'.repeat(64) }, { byteLength: payload.byteLength - 1 }, { compressedByteLength: compressed.length + 1 }]) {
    const store = createStore({ fetchImpl: async () => new Response(compressed) });
    store.registerManifest({ schemaVersion: 1, tiles: [{ ...entry, ...wrong }] });
    assert.equal(await store.load(entry.identity, { idToCode }), null);
    assert.equal(store.stats().manifestHits, 0); store.dispose();
  }
});


test('manifest pixels do not await disk writes and pending persistence is bounded and cancellable', async () => {
  let writes = 0, reads = 0, writeSignal;
  const payloads = new Map([['a', encode('a')], ['b', encode('b')]]);
  const backend = { read: async () => { reads++; return null; }, writeBounded: (_entry, _limit, signal) => {
    writes++; writeSignal = signal;
    return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(Object.assign(new Error('cancelled'), { name: 'AbortError' })), { once: true }));
  } };
  const store = createStore({ backend, fetchImpl: async url => response(payloads.get(new URL(url, "http://localhost/").pathname.slice(1))) });
  store.registerManifest({ schemaVersion: 1, tiles: [...payloads].map(([identity, bytes]) => ({ identity, url: `/${identity}`, byteLength: bytes.byteLength })) });
  assert.ok(await store.load('a', { idToCode }));
  assert.equal(writes, 1); assert.equal(store.stats().pendingWrites, 1);
  assert.ok(await store.load('b', { idToCode }));
  assert.equal(reads, 1, 'a queued disk write must not block the next published tile');
  assert.equal(writes, 1, 'do not accumulate background write buffers');
  assert.equal(store.stats().pendingBytes, payloads.get('a').byteLength);
  store.dispose();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(writeSignal.aborted, true); assert.equal(store.stats().pendingWrites, 0);
  assert.equal(store.stats().pendingBytes, 0); assert.equal(store.stats().failures, 0);
});


test('slow optional disk lookup yields to a published tile without a producer failure', async () => {
  let readSignal;
  const payload = encode('published');
  const store = createStore({ backend: { read: (_id, _limit, signal) => {
    readSignal = signal;
    return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(Object.assign(new Error('cancelled'), { name: 'AbortError' })), { once: true }));
  }, writeBounded: async () => true }, fetchImpl: async () => response(payload) });
  store.registerManifest({ schemaVersion: 1, tiles: [{ identity: 'published', url: '/published', byteLength: payload.byteLength }] });
  assert.ok(await store.load('published', { idToCode }));
  assert.equal(readSignal.aborted, true);
  assert.equal(store.stats().cacheReadTimeouts, 1); assert.equal(store.stats().manifestHits, 1);
  assert.equal(store.stats().failures, 0); store.dispose();
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { createBathymetryTextureSource, loadBathymetryImageBitmap } from '../js/core/renderer/bathymetry_texture_source.js';

function setup(options = {}) {
  const manifest = { overview: { url: 'overview.png' }, tiles: { url_template: 'tiles/{col}_{row}.png',
    present: ['0_0', '17_0', '0_4', '17_4', '8_4', '9_4', '0_8', '17_8', '2_2', '3_3'] } };
  const source = createBathymetryTextureSource({ manifestUrl: 'manifest.json',
    fetchJson: async (url) => { assert.equal(url, 'manifest.json'); return manifest; },
    loadImageBitmap: async (url) => ({ url }), ...options });
  return { source, manifest };
}

test('load and geographic tile intersection support antimeridian, poles and present filtering', async () => {
  const { source, manifest } = setup();
  assert.equal(await source.load(), true);
  assert.equal(source.getManifest(), manifest);
  assert.equal(source.getOverview().url, 'overview.png');
  assert.equal(source.getCapacity(), 64);
  assert.deepEqual(source.getTileKeysForBounds([-15, -5, 15, 5]), ['8_4', '9_4']);
  assert.deepEqual(source.getTileKeysForBounds([175, -5, -175, 5]), ['0_4', '17_4']);
  assert.deepEqual(source.getTileKeysForBounds([-180, 80, 180, 90]), ['0_0', '17_0']);
  assert.deepEqual(source.getTileKeysForBounds([-180, -90, 180, -80]), ['0_8', '17_8']);
  assert.deepEqual(source.getTileKeysForBounds([40, 10, 60, 30]), []);
  assert.deepEqual(source.getTileKeysForBounds([-20, -10, 0, 10]), ['8_4']);
});

test('simultaneous requests share a six-load concurrency limit and deduplicate pending keys', async () => {
  const releases = [], calls = new Map();
  let active = 0, peak = 0;
  const { source, manifest } = setup({ loadImageBitmap: async (url) => {
    if (url === 'overview.png') return { url };
    calls.set(url, (calls.get(url) || 0) + 1);
    active++; peak = Math.max(peak, active);
    await new Promise((resolve) => releases.push(resolve));
    active--; return { url };
  } });
  await source.load();
  const first = source.requestTiles(manifest.tiles.present);
  const second = source.requestTiles(manifest.tiles.present);
  await new Promise(setImmediate);
  assert.equal(active, 6);
  while (releases.length) {
    releases.splice(0).forEach((resolve) => resolve());
    await new Promise(setImmediate);
  }
  await Promise.all([first, second]);
  assert.equal(peak, 6);
  assert.equal(calls.size, manifest.tiles.present.length);
  assert.ok([...calls.values()].every((count) => count === 1));
  assert.equal(source.getRevision(), manifest.tiles.present.length);
});

test('LRU touches, eviction, resource release, notifications and revision are observable', async () => {
  const closed = [], notifications = [];
  const { source } = setup({ maxCachedTiles: 2, onTileLoaded: (key) => notifications.push(key),
    loadImageBitmap: async (url) => ({ url, close: () => closed.push(url) }) });
  await source.load();
  await source.requestTiles(['0_0', '17_0']);
  assert.equal(source.getCapacity(), 2);
  assert.equal(source.getRevision(), 2);
  await source.requestTiles(['0_0']);
  await source.requestTiles(['0_4']);
  assert.deepEqual([...source.getLoadedTiles().keys()], ['0_0', '0_4']);
  assert.equal(source.getRevision(), 4);
  assert.deepEqual(closed, ['tiles/17_0.png']);
  assert.deepEqual(notifications, ['0_0', '17_0', '0_4']);
});

test('production loader preserves encoded bytes and rejects unsuccessful HTTP responses', async (t) => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'createImageBitmap');
  const blob = new Blob(['encoded PNG']), bitmap = { width: 2, height: 2 };
  let calls = 0;
  Object.defineProperty(globalThis, 'createImageBitmap', { configurable: true, value: async (input, options) => {
    calls++;
    assert.equal(input, blob);
    assert.deepEqual(options, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
    return bitmap;
  } });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, 'createImageBitmap', previous);
    else delete globalThis.createImageBitmap;
  });
  assert.equal(await loadBathymetryImageBitmap('depth.png', { fetchImpl: async (url) => {
    assert.equal(url, 'depth.png');
    return { ok: true, blob: async () => blob };
  } }), bitmap);
  await assert.rejects(loadBathymetryImageBitmap('missing.png', {
    fetchImpl: async () => ({ ok: false, status: 404 }),
  }), /404/);
  assert.equal(calls, 1);
});

test('failed tiles cool down against the injected clock without request-loop retries', async () => {
  let clock = 100, attempts = 0;
  const { source } = setup({ now: () => clock, loadImageBitmap: async (url) => {
    if (url === 'overview.png') return {};
    attempts++;
    if (attempts === 1) throw new Error('unavailable');
    return {};
  } });
  await source.load();
  await source.requestTiles(['0_0']);
  for (let i = 0; i < 20; i++) await source.requestTiles(['0_0']);
  assert.equal(attempts, 1);
  assert.equal(source.getRevision(), 0);
  clock += 29999;
  await source.requestTiles(['0_0']); assert.equal(attempts, 1);
  clock++;
  await source.requestTiles(['0_0']); assert.equal(attempts, 2);
  assert.equal(source.getRevision(), 1);
});

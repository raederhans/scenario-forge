import assert from 'node:assert/strict';
import test from 'node:test';
import { createBathymetryTextureSource, loadBathymetryImageBitmap } from '../js/core/renderer/bathymetry_texture_source.js';

function setup() {
  const manifest = { overview: { url: 'overview.png' }, tiles: { url_template: 'tiles/{col}_{row}.png',
    present: ['0_0', '17_0', '0_4', '17_4', '8_4', '9_4', '0_8', '17_8', '2_2', '3_3'] } };
  const source = createBathymetryTextureSource({ manifestUrl: 'manifest.json',
    fetchJson: async (url) => { assert.equal(url, 'manifest.json'); return manifest; },
    loadImageBitmap: async (url) => ({ url }) });
  return source;
}

test('tile selection crosses the antimeridian', async () => {
  const source = setup();
  assert.equal(await source.load(), true);
  assert.deepEqual(source.getTileKeysForBounds([175, -5, -175, 5]), ['0_4', '17_4']);
});

test('production loader preserves encoded bytes', async (t) => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'createImageBitmap');
  const blob = new Blob(['encoded PNG']), bitmap = { width: 2, height: 2 };
  Object.defineProperty(globalThis, 'createImageBitmap', { configurable: true, value: async (input, options) => {
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
});

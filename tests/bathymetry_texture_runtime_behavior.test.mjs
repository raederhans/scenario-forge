import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import { createBathymetryTextureRuntime } from '../js/core/renderer/bathymetry_texture_runtime.js';

const vendor = vm.createContext({});
vm.runInContext(fs.readFileSync(new URL('../vendor/d3.v7.min.js', import.meta.url), 'utf8'), vendor);
const manifest = { overview: { url: 'overview' }, encoding: { max_depth_m: 11000 },
  tiles: { present: ['8_4', '9_4'], url_template: 'tiles/{col}_{row}' } };
const overlayManifest = (url) => ({ overlay: { url: `${url}.png` }, bounds: [-20, -10, 20, 10] });
const bitmap = (url) => ({ url, width: 2, height: 2, closes: 0, close() { this.closes++; } });
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
const settle = () => new Promise(resolve => setImmediate(resolve));

function harness(overrides) {
  const renders = [];
  const projection = vendor.d3.geoEqualEarth().scale(100).translate([1, 1]);
  const context = { canvas: { width: 2, height: 2 },
    transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }, globalAlpha: 1,
    getTransform() { return this.transform; },
    save() {}, restore() {}, setTransform() {}, drawImage() {},
  };
  const canvas = {};
  const options = { oceanStyle: { experimentalAdvancedStyles: true, preset: 'bathymetry_soft',
    opacity: .6, scale: 1, contourStrength: .3 }, baseRgb: { r: 100, g: 150, b: 200 } };
  const runtime = createBathymetryTextureRuntime({
    globalManifestUrl: 'global',
    fetchJson: async url => url === 'global' ? manifest : overlayManifest(url),
    createCanvas: () => canvas,
    getProjection: () => projection,
    getProjectionGeneration: () => 1,
    createRenderer: () => ({
      prewarm() {},
      render(args) {
        renders.push(args);
        return { canvas, backend: 'cpu', coveredBounds: [-20, -10, 20, 10], missingTileKeys: [] };
      },
    }), ...overrides,
  });
  return { runtime, renders, draw: () => runtime.draw(context, options) };
}

test('late scenario overlay leaves the current bathymetry bitmap active', async () => {
  const old = deferred();
  const h = harness({ loadImageBitmap: async url => url === 'old.png' ? old.promise : bitmap(url) });
  h.runtime.setScenarioOverlayUrl('old');
  const first = h.runtime.ensure();
  await settle();
  h.runtime.setScenarioOverlayUrl('new');
  await h.runtime.ensure();
  const stale = bitmap('old.png'); old.resolve(stale); await first;
  assert.equal(stale.closes, 1);
  assert.equal(h.draw().activeBathymetrySource, 'merged');
  const overlay = h.renders.at(-1).overlay;
  assert.equal(overlay.bitmap.url, 'new.png');
  assert.deepEqual(overlay.bounds, [-20, -10, 20, 10]);
});
